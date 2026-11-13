import { clearSession } from "./session";
import { rememberRecovery } from "./valueRecovery";
import { rememberCall, MY_CALLS_EVENT } from "./myCalls";
import type { Op, SignedAuth } from "./nep413";
export interface WorkerResult { call_id: string | null; status: string | null; output: Record<string, any> | null; attestation_url: string | null; time_ms: number | null; error?: { code: string; message?: string; retry_after?: number } }
// The worker runs up to 180 s; the gateway returns "processing" with the call
// id when a call outlasts one gateway request (~48 s of internal polling).
// Resume-poll GET /api/worker?call_id=... until the call is terminal, so a slow
// swap is retrieved across several short requests instead of dying at Vercel's
// 60 s limit. Each individual request stays well under that limit.
const POLL_INTERVAL_MS = 5_000;
const POLL_BUDGET_MS = 180_000;
async function pollWorkerCall(callId: string): Promise<WorkerResult | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < POLL_BUDGET_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const r = await fetch(`/api/worker?call_id=${encodeURIComponent(callId)}`, { headers: { "content-type": "application/json" } });
    const j = await r.json().catch(() => null) as WorkerResult | null;
    if (!j) return null;
    if (j.error) return j;
    if (j.status !== "processing") return j;
  }
  return { call_id: callId, status: "processing", output: null, attestation_url: null, time_ms: null };
}
export async function callWorker(op: Op, auth?: SignedAuth): Promise<WorkerResult> {
  // NEAR wallets omit the optional scheme; native/exact host admission requires an explicit NEP-413 tag.
  const transportAuth = auth && auth.scheme === undefined ? { ...auth, scheme: "nep413" as const } : auth;
  const r = await fetch("/api/worker", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, auth: transportAuth }) });
  let j = await r.json().catch(() => ({ ok: false, error: { code: "gateway" } }));
  if (j && !j.error && j.status === "processing" && typeof j.call_id === "string" && j.call_id) {
    const resumed = await pollWorkerCall(j.call_id).catch(() => null);
    if (resumed) j = resumed;
  }
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
