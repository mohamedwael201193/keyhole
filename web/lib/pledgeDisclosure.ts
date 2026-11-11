/**
 * Borrower and lender disclosure copy for Pledge. One place, so the screen and the tests read the same words.
 * Amounts are exact NEAR decimals from yocto; nothing is rounded for display.
 */
import { compareLoanSwap } from "./pledgeEconomics";

/** First line of the borrower screen, before any number. */
export const FORFEIT_LINE = "If you default, the lender receives the whole key and everything in its vault.";
/** The checkbox that enables the sign button. */
export const FORFEIT_ACK = "I understand the whole account is forfeited on default";
/** Lender side: what the floor is and is not. */
export const FLOOR_NOTE = "Raw-token minimum at freeze — not a USD value, not LTV, not solvency, not a ZK proof. One floor, fixed in the loan terms.";

/** Exact NEAR decimal from yocto (24 decimals), trailing zeros trimmed. */
export function nearText(yocto: bigint): string {
  const neg = yocto < 0n;
  const n = neg ? -yocto : yocto;
  const whole = n / 10n ** 24n;
  const frac = (n % 10n ** 24n).toString().padStart(24, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export type BorrowerNumbers = { borrow: string; repay: string; cost: string };
/** Total cost is repayment minus principal, both exact. Throws unless 0 < principal <= repayment. */
export function borrowerNumbers(principalYocto: string, repaymentYocto: string): BorrowerNumbers {
  const p = BigInt(principalYocto), r = BigInt(repaymentYocto);
  if (p <= 0n || r < p) throw Error("Repayment must cover a positive principal.");
  return { borrow: nearText(p), repay: nearText(r), cost: nearText(r - p) };
}

/**
 * One line comparing with selling part of the vault through a swap instead. Uses compareLoanSwap. Without a same-ledger
 * quote the function reports unavailable, and this line says so. It never invents a comparison.
 */
export function swapComparisonLine(principalYocto: string, repaymentYocto: string): string {
  const unavailable = "Selling part of the vault via swap instead: no same-ledger swap quote is available at this size, so this page cannot compare the two.";
  try {
    const r = compareLoanSwap({ principal: principalYocto, repayment: repaymentYocto, bond: "0", incrementalLoanCost: "0", payoutStorageCost: null, quote: null, ledger: "", nowMs: 0 });
    return r.available ? `Selling part of the vault via swap instead: ${r.recommendation}.` : unavailable;
  } catch {
    return unavailable;
  }
}
