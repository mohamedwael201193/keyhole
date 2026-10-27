import type { Op, SignedAuth } from "./nep413";
export interface WorkerResult { call_id: string | null; status: string | null; output: Record<string, any> | null; attestation_url: string | null; time_ms: number | null; error?: { code: string; message?: string; retry_after?: number } }
export async function callWorker(op: Op, auth?: SignedAuth): Promise<WorkerResult> {
  const r = await fetch("/api/worker", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, auth }) });
  const j = await r.json().catch(() => ({ ok: false, error: { code: "gateway" } }));
  if (j.error) return { call_id: null, status: null, output: null, attestation_url: null, time_ms: null, error: j.error };
  const out = j.output as Record<string, any> | null;
  if (out && out.ok === false) return { ...j, error: out.error };
  return j;
}
