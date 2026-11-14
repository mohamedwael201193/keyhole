/**
 * Lien facts for one key, read from the final chain. Pure functions only: the panel and the timeline call these
 * with views they already read. Every refusal row names the file and lines it was read from. The CLI carries an
 * identical copy of LIEN_REFUSALS and cli/test/pledge.test.ts fails if the two tables differ.
 * This is the set of paths read in the source, not a full audit of every owner-changing path.
 */
import type { Loan, PledgeConfig } from "./pledgeClient";

export type LienControl = { token_id?: string; owner_epoch: string; pending_value_ops: string; listed: boolean; transfer_pending: boolean; pledged: boolean; value_op_nonce?: string };

export const PLEDGED_CONTRACT = "pledged: ownership and value operations locked";
export const PLEDGED_ENCLAVE = "pledged: all custody value operations are locked";

export const LIEN_REFUSALS = [
  { action: "transfer", refused_by: "contract", code: PLEDGED_CONTRACT, source: "contracts/keys/src/lib.rs:749-751 nft_transfer and 760-762 nft_transfer_call (assert_can_change_owner, lib.rs:411-412, then assert_token_idle, pledge.rs:504); nft_transfer_payout lib.rs:717 via transfer_key lib.rs:443-444" },
  { action: "list", refused_by: "contract", code: PLEDGED_CONTRACT, source: "contracts/keys/src/lib.rs:472-478 nft_list (assert_token_idle)" },
  { action: "buy", refused_by: "contract", code: PLEDGED_CONTRACT, source: "contracts/keys/src/lib.rs:521-522 nft_buy (assert_can_change_owner)" },
  { action: "sale", refused_by: "contract", code: PLEDGED_CONTRACT, source: "contracts/keys/src/sale.rs:49 open_sale (assert_can_change_owner)" },
  { action: "withdraw", refused_by: "enclave", code: "pledged", message: PLEDGED_ENCLAVE, source: "tee/worker/src/guarded.rs:35 Control::admit, reached from op_withdraw via guard_preflight (tee/worker/src/main.rs:577)" },
  { action: "swap", refused_by: "enclave", code: "pledged", message: PLEDGED_ENCLAVE, source: "tee/worker/src/guarded.rs:35 Control::admit, reached from op_swap via guard_preflight (tee/worker/src/main.rs:527)" },
  { action: "copy", refused_by: "enclave", code: "pledged", message: PLEDGED_ENCLAVE, source: "tee/worker/src/guarded.rs:35 Control::admit, reached from op_swap(copy) via guard_preflight (tee/worker/src/main.rs:527)" },
  { action: "withdraw_dry_run", refused_by: "enclave", code: "pledged", message: PLEDGED_ENCLAVE, source: "tee/worker/src/guarded.rs:35 Control::admit, reached via guard_preflight (tee/worker/src/guarded_host.rs:27-28)" },
] as const;

/**
 * The only way the key moves under a loan that this page reads: the named lender's claim_default, after due + grace.
 * claim_default (contracts/keys/src/pledge.rs:676-681) calls transfer_key_unlocked, which skips assert_token_idle.
 */
export const DEFAULT_PATH_RULES = [
  { code: "only lender", meaning: "only the lender named in the loan terms can call claim_default", source: "contracts/keys/src/pledge.rs:676-681 claim_default" },
  { code: "loan not active", meaning: "the loan must be Active (funded and delivered)", source: "contracts/keys/src/pledge.rs:676-681 claim_default" },
  { code: "default not due", meaning: "refused until block time is after due + grace", source: "contracts/keys/src/pledge.rs:676-681 claim_default" },
  { code: "distinct external receiver required", meaning: "the receiver cannot be the borrower or the contract", source: "contracts/keys/src/pledge.rs:676-681 claim_default" },
  { code: "default claim period", meaning: "repay_loan is refused after due + grace; the lender can claim from then", source: "contracts/keys/src/pledge.rs repay_loan" },
] as const;

/** Borrower-signed terms as the contract stores them. due + grace is the first instant a default is claimable. */
export function defaultClaimableAtNs(loan: Pick<Loan, "due_ns" | "terms">): bigint | null {
  try { return BigInt(loan.due_ns) + BigInt(loan.terms.grace_sec) * 1_000_000_000n; } catch { return null; }
}

export function lendingText(config: PledgeConfig | null | undefined): string {
  if (config === undefined || config === null) return "Pledge config is not present on this contract.";
  const where = config.network || "this network";
  return config.lending_enabled
    ? `Lending is enabled on ${where}.`
    : `Lending is off on ${where}. No loan can be opened or funded from this site; anything shown here is what the contract holds.`;
}

/**
 * controlRead is false when the control view was not read. The panel then says "Not read" and does not claim the key
 * is unlocked; a loan record is still shown on its own.
 */
export function lienState(control: LienControl | null, loan: Loan | null, config: PledgeConfig | null | undefined) {
  const controlRead = control !== null && control !== undefined;
  const pendingOps = controlRead ? control.pending_value_ops !== "0" : false;
  const locked = controlRead
    ? !!(control.pledged || loan !== null || control.listed || control.transfer_pending || pendingOps)
    : false;
  return {
    controlRead,
    locked,
    /** Refusal rows apply while the key is pledged or a loan record exists. */
    refusalsApply: (controlRead && control.pledged) || loan !== null,
    loanOpen: loan !== null && loan.state !== "UnlockPending",
    activeLoan: loan !== null && loan.state === "Active",
    defaultClaimableAtNs: loan && loan.state === "Active" ? defaultClaimableAtNs(loan) : null,
    lendingEnabled: config === undefined || config === null ? null : config.lending_enabled,
    lendingLine: lendingText(config),
  };
}

/** The word the lien panel prints. A failed or incomplete read stays "Not read" and never "Not locked". */
export function lienPanelLabel(status: "idle" | "loading" | "ready" | "error", control: LienControl | null, loan: Loan | null): string {
  if (status === "loading") return "Reading";
  const s = lienState(control, loan, undefined);
  if (status === "error" || !s.controlRead) return "Not read";
  return s.locked ? "Locked" : "Not locked";
}

/** Chain time in Africa/Cairo, including seconds. The instant itself is not a claimable default: the contract uses a strict greater-than. */
export function formatNs(ns: bigint | null): string {
  if (ns === null) return "unknown";
  const ms = ns / 1_000_000n;
  if (ms > BigInt(Number.MAX_SAFE_INTEGER)) return "unknown";
  const formatted = new Date(Number(ms)).toLocaleString("en-GB", {
    timeZone: "Africa/Cairo", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  return `${formatted} Africa/Cairo`;
}
