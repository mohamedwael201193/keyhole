import "server-only";
import { OUTLAYER_API, OUTLAYER_OWNER, OUTLAYER_PROJECT } from "./config";
export interface Health { at: number; online: boolean; reason: string | null }
let cache: Health | null = null;
/** Is the TEE reachable and funded? One tiny `info` call per minute per instance at most. */
export async function getHealth(): Promise<Health> {
  if (cache && Date.now() - cache.at < 60_000) return cache;
  const key = process.env.OUTLAYER_PAYMENT_KEY;
  let online = false, reason: string | null = "gateway";
  if (key) {
    try {
      const r = await fetch(`${OUTLAYER_API}/call/${OUTLAYER_OWNER}/${OUTLAYER_PROJECT}`, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(20_000),
        headers: { "X-Payment-Key": key, "content-type": "application/json" },
        body: JSON.stringify({ input: { op: "info" }, async: false, secrets_ref: { profile: "default", account_id: OUTLAYER_OWNER } }) });
      const j = await r.json().catch(() => null);
      if (j?.output?.ok) { online = true; reason = null; } else reason = j?.reason === "insufficient_balance" ? "service_unfunded" : "gateway";
    } catch { reason = "network"; }
  }
  cache = { at: Date.now(), online, reason };
  return cache;
}
