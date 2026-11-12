import { clearSession } from "./session";
import { rememberRecovery } from "./valueRecovery";
import { rememberCall, MY_CALLS_EVENT } from "./myCalls";
import type { Op, SignedAuth } from "./nep413";
export interface WorkerResult { call_id: string | null; status: string | null; output: Record<string, any> | null; attestation_url: string | null; time_ms: number | null; error?: { code: string; message?: string; retry_after?: number } }
export async function callWorker(op: Op, auth?: SignedAuth): Promise<WorkerResult> {
  // NEAR wallets omit the optional scheme; native/exact host admission requires an explicit NEP-413 tag.
  const transportAuth = auth && auth.scheme === undefined ? { ...auth, scheme: "nep413" as const } : auth;
  const r = await fetch("/api/worker", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, auth: transportAuth }) });
  const j = await r.json().catch(() => ({ ok: false, error: { code: "gateway" } }));
  if (typeof window !== "undefined") { try { rememberRecovery(auth, j.output ?? j); window.dispatchEvent(new Event("keyhole-recovery")); } catch { /* storage unavailable; worker retains journal */ } }
  if (typeof window !== "undefined" && auth?.scheme === "session" && ["session_epoch", "session_expired", "session_revoked", "not_owner"].includes(j.output?.error?.code ?? j.error?.code)) {
    try { clearSession(); window.dispatchEvent(new Event("keyhole-session-invalid")); } catch { /* blocked storage does not weaken server auth */ }
  }
  if (typeof window !== "undefined" && j.call_id && !j.error) { try { let acct: string | undefined; try { acct = JSON.parse(auth?.message ?? "{}").account_id; } catch { acct = undefined; }
      rememberCall(op, j.call_id, Date.now(), sessionStorage, typeof acct === "string" ? acct : undefined); window.dispatchEvent(new Event(MY_CALLS_EVENT)); } catch { /* storage unavailable; the list is a convenience */ } }
  if (j.error) return { call_id: null, status: null, output: null, attestation_url: null, time_ms: null, error: j.error };
  const out = j.output as Record<string, any> | null;
  if (out && out.ok === false) return { ...j, error: out.error };
  return j;
}
