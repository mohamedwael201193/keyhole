import "server-only";
import { OUTLAYER_API, OUTLAYER_OWNER, OUTLAYER_PROJECT } from "./config";
import { freshHealth, shareCheck } from "./healthGate";
export interface Health { at: number; online: boolean; reason: string | null }
let cache: Health | null = null;
const slot: { current: Promise<Health> | null } = { current: null };
async function ask(): Promise<Health> {
  const key = process.env.OUTLAYER_PAYMENT_KEY;
  const at = Date.now();
  if (!key) return { at, online: false, reason: "gateway" };
  try {
    const r = await fetch(`${OUTLAYER_API}/call/${OUTLAYER_OWNER}/${OUTLAYER_PROJECT}`, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(20_000),
      headers: { "X-Payment-Key": key, "content-type": "application/json" },
      body: JSON.stringify({ input: { op: "info" }, async: false, secrets_ref: { profile: "default", account_id: OUTLAYER_OWNER } }) });
    const j = await r.json().catch(() => null);
    if (j?.output?.ok) return { at, online: true, reason: null };
    return { at, online: false, reason: j?.reason === "insufficient_balance" ? "service_unfunded" : "gateway" };
  } catch { return { at, online: false, reason: "network" }; }
}
/** Is the TEE reachable and funded? A cold miss is tried once, then remembered for 15s. Live results last a minute. */
export async function getHealth(): Promise<Health> {
  const hit = freshHealth(cache);
  if (hit) return hit;
  return shareCheck(slot, async () => {
    let result = await ask();
    if (!result.online) result = await ask();
    cache = { ...result, at: Date.now() };
    return cache;
  });
}
