/**
 * Lien facts for one key, read from the final chain. Pure functions only: the panel and the timeline call these
 * with views they already read. Every refusal row names the file and the exact string the code returns, and a
 * test checks those strings against the source (web/tests/lien.test.ts), so the table cannot drift silently.
 */
import type { Loan, PledgeConfig } from "./pledgeClient";

export type LienControl = { token_id?: string; owner_epoch: string; pending_value_ops: string; listed: boolean; transfer_pending: boolean; pledged: boolean; value_op_nonce?: string };

export const LIEN_REFUSALS = [
  { action: "Transfer", refused_by: "Contract", code: "pledged: ownership and value operations locked", source: "contracts/keys/src/pledge.rs assert_token_idle (nft_transfer, nft_transfer_call, nft_transfer_payout)" },
  { action: "List for sale", refused_by: "Contract", code: "pledged: ownership and value operations locked", source: "contracts/keys/src/pledge.rs assert_token_idle (nft_list)" },
  { action: "Protected sale", refused_by: "Contract", code: "pledged: ownership and value operations locked", source: "contracts/keys/src/pledge.rs assert_token_idle (open_sale)" },
  { action: "Withdraw", refused_by: "Enclave", code: "pledged", message: "pledged: all custody value operations are locked", source: "tee/worker/src/guarded.rs GuardControl.admit" },
  { action: "Swap", refused_by: "Enclave", code: "pledged", message: "pledged: all custody value operations are locked", source: "tee/worker/src/guarded.rs GuardControl.admit" },
  { action: "Copy", refused_by: "Enclave", code: "pledged", message: "pledged: all custody value operations are locked", source: "tee/worker/src/guarded.rs GuardControl.admit" },
  { action: "Withdraw route preview", refused_by: "Enclave", code: "pledged", message: "pledged: all custody value operations are locked", source: "tee/worker/src/guarded_host.rs guard_preflight" },
] as const;

/** The only way the key moves under a loan: the named lender's default claim, after due + grace. */
export const DEFAULT_PATH_RULES = [
  { code: "only lender", meaning: "only the lender named in the loan terms can call claim_default", source: "contracts/keys/src/pledge.rs claim_default" },
  { code: "loan not active", meaning: "the loan must be Active (funded and delivered)", source: "contracts/keys/src/pledge.rs claim_default" },
  { code: "default not due", meaning: "refused until block time is after due + grace", source: "contracts/keys/src/pledge.rs claim_default" },
  { code: "distinct external receiver required", meaning: "the receiver cannot be the borrower or the contract", source: "contracts/keys/src/pledge.rs claim_default" },
  { code: "default claim period", meaning: "repay_loan is refused after due + grace; the lender can claim from then", source: "contracts/keys/src/pledge.rs repay_loan" },
] as const;

/** Borrower-signed terms as the contract stores them. due + grace is the first instant a default is claimable. */
export function defaultClaimableAtNs(loan: Pick<Loan, "due_ns" | "terms">): bigint | null {
  try { return BigInt(loan.due_ns) + BigInt(loan.terms.grace_sec) * 1_000_000_000n; } catch { return null; }
}

export function lienState(control: LienControl | null, loan: Loan | null, config: PledgeConfig | null | undefined) {
  const pendingOps = control ? control.pending_value_ops !== "0" : false;
  const locked = !!control && (control.pledged || loan !== null || control.listed || control.transfer_pending || pendingOps);
  const openLoan = loan !== null && loan.state !== "UnlockPending";
  const lendingEnabled = config === undefined || config === null ? null : config.lending_enabled;
  return {
    locked,
    /** Refusal rows apply while a loan record exists or the key is pledged. */
    refusalsApply: !!control && (control.pledged || loan !== null),
    loanOpen: openLoan,
    activeLoan: loan !== null && loan.state === "Active",
    defaultClaimableAtNs: loan && loan.state === "Active" ? defaultClaimableAtNs(loan) : null,
    lendingEnabled,
    lendingLine: lendingEnabled === null
      ? "Pledge config is not present on this contract."
      : lendingEnabled
        ? "Lending is enabled on this contract."
        : "Lending is off on mainnet. No loan can be opened or funded from this site; anything shown here is what the contract holds.",
  };
}

export function formatNs(ns: bigint | null): string {
  if (ns === null) return "unknown";
  return new Date(Number(ns / 1_000_000n)).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
