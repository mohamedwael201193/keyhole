import "server-only";
import { OUTLAYER_API, OUTLAYER_OWNER, OUTLAYER_PROJECT } from "./config";

export interface Health {
  at: number;
  /** null means this response did not probe the enclave. */
  online: boolean | null;
  reason: string | null;
  mode: "passive" | "active";
  fresh: boolean;
  payer: string | null;
}

/** Default health. No OutLayer call, no payment key, no compute spend. Not a fresh online pass. */
export function passiveHealth(at = Date.now()): Health {
  return { at, online: null, reason: "not_probed", mode: "passive", fresh: false, payer: null };
}

export async function getHealth(): Promise<Health> {
  return passiveHealth();
}

/**
 * One bounded info execution. Callers must already have an explicit approval.
 * Discloses the project that pays. Does not return the payment key.
 */
export async function probeHealth(at = Date.now()): Promise<Health> {
  const payer = `${OUTLAYER_OWNER}/${OUTLAYER_PROJECT}`;
  const key = process.env.OUTLAYER_PAYMENT_KEY;
  if (!key) return { at, online: false, reason: "gateway", mode: "active", fresh: true, payer };
  try {
    const r = await fetch(`${OUTLAYER_API}/call/${OUTLAYER_OWNER}/${OUTLAYER_PROJECT}`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(20_000),
      headers: { "X-Payment-Key": key, "content-type": "application/json" },
      body: JSON.stringify({ input: { op: "info" }, async: false, secrets_ref: { profile: "default", account_id: OUTLAYER_OWNER } }),
    });
    const j = await r.json().catch(() => null);
    if (j?.output?.ok) return { at, online: true, reason: null, mode: "active", fresh: true, payer };
    return { at, online: false, reason: j?.reason === "insufficient_balance" ? "service_unfunded" : "gateway", mode: "active", fresh: true, payer };
  } catch {
    return { at, online: false, reason: "network", mode: "active", fresh: true, payer };
  }
}
