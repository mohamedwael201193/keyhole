/**
 * Decision on a withdraw_dry_run result. The enclave's dry run (tee/worker/src/collateral_host.rs op_withdraw_dry_run)
 * asks the provider for an advisory route preview and moves nothing. The documented
 * provider withdraw request cannot bind a minimum, so no preview authorizes execution.
 */
export type DryRunIntent = { account: string; token: string; amount: string; chain: string };
export type DryRunDecision = { ok: true; amount_out: string; min_amount_out: string } | { ok: false; reason: string };

const positive = (v: unknown): v is string | number => (typeof v === "string" ? /^[1-9]\d*$/.test(v) : typeof v === "number" && Number.isSafeInteger(v) && v > 0);

export function withdrawDryRunDecision(out: unknown, intent: DryRunIntent): DryRunDecision {
  const no = (reason: string): DryRunDecision => ({ ok: false, reason: `${reason} No withdrawal was signed.` });
  const o = out as Record<string, unknown> | null | undefined;
  if (!o || o.ok !== true || o.op !== "withdraw_dry_run") return no("Route preview unavailable.");
  if (o.broadcast !== false) return no("Route preview did not confirm that nothing is broadcast.");
  // Bind the preview to this exit: the destination, amount, token and chain must be the ones the user is about to sign.
  if (o.to !== intent.account) return no("Route preview names another destination.");
  if (String(o.amount) !== intent.amount) return no("Route preview names another amount.");
  if (o.token !== intent.token) return no("Route preview names another token.");
  if (o.chain !== intent.chain) return no("Route preview names another chain.");
  if (!positive(o.amount_out)) return no("Route preview returned no positive amount_out.");
  if (!positive(o.min_amount_out)) return no("Route preview returned no positive min_amount_out.");
  return no("Preview is advisory only: provider execution cannot enforce this minimum. Stop for a separately approved slippage/fee policy.");
}

/** Text of the confirm step. The numbers are the preview's own values, shown before the withdrawal is signed. */
export function exitConfirmText(d: { amount_out: string; min_amount_out: string }, amount: string): string {
  return `Withdraw ${amount} base units. Route preview: amount_out ${d.amount_out}, advisory minimum ${d.min_amount_out} (base units). Not an executable quote; do not sign a withdrawal.`;
}
