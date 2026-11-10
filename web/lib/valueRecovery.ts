/** Only operation identity is kept: never an auth envelope, token, amount or private trade. One key per journal avoids cross-tab lost updates. */
export type Recovery = { account: string; token_id: string; value_op_id: string; status: string };
const prefix = "kh_value_recovery_v1:";
export const valueOpId = (v: unknown): v is string => typeof v === "string" && /^[1-9]\d{0,19}:[0-9a-f]{64}$/.test(v);
const key = (r: Recovery) => prefix + JSON.stringify([r.account, r.token_id, r.value_op_id]);
export function rememberRecovery(auth: { message: string } | undefined, out: Record<string, any> | null, store: Storage = localStorage) {
  if (!auth || !out) return;
  const m = JSON.parse(auth.message);
  const id = out.pending_value_op?.value_op_id ?? out.value_op_id ?? /reconcile (?:operation )?([1-9]\d{0,19}:[0-9a-f]{64})/.exec(out.error?.message ?? "")?.[1];
  if (!valueOpId(id) || typeof m.account_id !== "string" || typeof (out.pending_value_op?.token_id ?? m.params?.token_id) !== "string") return;
  const r: Recovery = { account: m.account_id, token_id: out.pending_value_op?.token_id ?? m.params.token_id, value_op_id: id, status: out.status ?? "UNKNOWN" };
  if (out.admission_finished === true && ["success", "completed", "failed", "refunded"].includes(r.status)) store.removeItem(key(r));
  else store.setItem(key(r), JSON.stringify(r));
}
export function recoveries(account: string, store: Storage = localStorage): Recovery[] {
  const rows: Recovery[] = [];
  for (let i = 0; i < store.length; i++) { const k = store.key(i); if (!k?.startsWith(prefix)) continue;
    try { const r = JSON.parse(store.getItem(k) ?? "null"); if (r?.account === account && typeof r.token_id === "string" && valueOpId(r.value_op_id)) rows.push(r); } catch { /* unrelated damaged row */ }
  }
  return rows;
}
