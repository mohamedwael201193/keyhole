/**
 * Decision on a withdraw_dry_run result. The enclave's dry run (tee/worker/src/collateral_host.rs op_withdraw_dry_run)
 * asks the provider for a route preview and moves nothing. The wallet may sign the real withdrawal only when both
 * route numbers are positive. Anything else, including a missing field, is a refusal.
 */
export type DryRunDecision = { ok: true; amount_out: string; min_amount_out: string } | { ok: false; reason: string };

const positive = (v: unknown): v is string | number => (typeof v === "string" ? /^[1-9]\d*$/.test(v) : typeof v === "number" && Number.isSafeInteger(v) && v > 0);

export function withdrawDryRunDecision(out: unknown): DryRunDecision {
  const o = out as { ok?: unknown; op?: unknown; broadcast?: unknown; amount_out?: unknown; min_amount_out?: unknown } | null | undefined;
  if (!o || o.ok !== true || o.op !== "withdraw_dry_run") return { ok: false, reason: "Route preview unavailable. No withdrawal was signed." };
  if (o.broadcast !== false) return { ok: false, reason: "Route preview did not confirm that nothing is broadcast. No withdrawal was signed." };
  if (!positive(o.amount_out)) return { ok: false, reason: "Route preview returned no positive amount_out. No withdrawal was signed." };
  if (!positive(o.min_amount_out)) return { ok: false, reason: "Route preview returned no positive min_amount_out. No withdrawal was signed." };
  return { ok: true, amount_out: String(o.amount_out), min_amount_out: String(o.min_amount_out) };
}
