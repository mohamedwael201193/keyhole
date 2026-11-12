import type { AttackCase } from "./liveChecks";

/**
 * Counts for the attack board. Refusals (attestation cases) and the allowed transfer (tx case) are counted apart,
 * so a successful transfer is never reported as a refusal.
 */
export function attackSummary(
  cases: readonly AttackCase[],
  results: Record<string, { ok: boolean | null } | null | undefined>,
) {
  const refusals = cases.filter((c) => c.kind === "attestation");
  const transfers = cases.filter((c) => c.kind === "tx");
  const passed = (list: readonly AttackCase[]) => list.filter((c) => results[c.id]?.ok === true).length;
  const refusalPass = passed(refusals);
  const transferPass = passed(transfers);
  const allPass = refusalPass === refusals.length && transferPass === transfers.length;
  const text = `${refusalPass}/${refusals.length} refusals confirmed, ${transferPass}/${transfers.length} allowed transfer confirmed`;
  return { refusalPass, refusalTotal: refusals.length, transferPass, transferTotal: transfers.length, allPass, text };
}
