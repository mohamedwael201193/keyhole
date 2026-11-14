// Read-only lien status for one key: views only, no signature, no transaction.
// The refusal table is identical to web/lib/lien.ts (cli/test/pledge.test.ts fails if they differ). Each row names the
// source it was read from. This is the paths read in the source, not a full audit of every owner-changing path.
import { contractView } from "./core.js";

/** New keys are k + 16 lowercase hex (as tee/worker and web/lib/chainsig.ts read them); early keys are plain numbers. */
export const KEY_ID = /^(k[0-9a-f]{16}|\d{1,9})$/;

export type View = <T>(method: string, args: Record<string, unknown>) => Promise<T>;

export type Loan = {
  token_id: string; nonce: string; borrower: string; owner_epoch: string;
  terms: { lender: string; principal: string; repayment: string; duration_sec: string; grace_sec: string; floor_raw: string; funding_deadline_ns: string };
  state: string; due_ns: string; resolution: string | null;
};
export type Control = { token_id: string; owner_epoch: string; pending_value_ops: string; listed: boolean; transfer_pending: boolean; pledged: boolean; value_op_nonce: string };
export type PledgeConfig = { network: string; lending_enabled: boolean; next_loan_nonce: string } | null;

const PLEDGED_CONTRACT = "pledged: ownership and value operations locked";
const PLEDGED_ENCLAVE = "pledged: all custody value operations are locked";

/** Actions refused while a loan is open. Identical to web/lib/lien.ts LIEN_REFUSALS. */
export const LIEN_REFUSALS = [
  { action: "transfer", refused_by: "contract", code: PLEDGED_CONTRACT, source: "contracts/keys/src/lib.rs:749-751 nft_transfer and 760-762 nft_transfer_call (assert_can_change_owner, lib.rs:411-412, then assert_token_idle, pledge.rs:504); nft_transfer_payout lib.rs:717 via transfer_key lib.rs:443-444" },
  { action: "list", refused_by: "contract", code: PLEDGED_CONTRACT, source: "contracts/keys/src/lib.rs:472-478 nft_list (assert_token_idle)" },
  { action: "buy", refused_by: "contract", code: PLEDGED_CONTRACT, source: "contracts/keys/src/lib.rs:521-522 nft_buy (assert_can_change_owner)" },
  { action: "sale", refused_by: "contract", code: PLEDGED_CONTRACT, source: "contracts/keys/src/sale.rs:49 open_sale (assert_can_change_owner)" },
  { action: "withdraw", refused_by: "enclave", code: "pledged", message: PLEDGED_ENCLAVE, source: "tee/worker/src/guarded.rs:35 Control::admit, reached from op_withdraw via guard_preflight (tee/worker/src/main.rs:577)" },
  { action: "swap", refused_by: "enclave", code: "pledged", message: PLEDGED_ENCLAVE, source: "tee/worker/src/guarded.rs:35 Control::admit, reached from op_swap via guard_preflight (tee/worker/src/main.rs:527)" },
  { action: "copy", refused_by: "enclave", code: "pledged", message: PLEDGED_ENCLAVE, source: "tee/worker/src/guarded.rs:35 Control::admit, reached from op_swap(copy) via guard_preflight (tee/worker/src/main.rs:527)" },
  { action: "withdraw_dry_run", refused_by: "enclave", code: "pledged", message: PLEDGED_ENCLAVE, source: "tee/worker/src/guarded.rs:35 Control::admit, reached via guard_preflight (tee/worker/src/guarded_host.rs:39-40)" },
] as const;

/** The only way the key moves under a loan that this page reads. Identical to web/lib/lien.ts DEFAULT_PATH_RULES. */
export const DEFAULT_PATH = {
  who: "the lender named in get_loan terms.lender, and nobody else",
  when: "loan state Active, and block time after due_ns + grace_sec (repay_loan is refused after that point)",
  refusals: [
    { code: "only lender", source: "contracts/keys/src/pledge.rs:676-681 claim_default" },
    { code: "loan not active", source: "contracts/keys/src/pledge.rs:676-681 claim_default" },
    { code: "default not due", source: "contracts/keys/src/pledge.rs:676-681 claim_default" },
    { code: "distinct external receiver required", source: "contracts/keys/src/pledge.rs:676-681 claim_default" },
    { code: "default claim period", source: "contracts/keys/src/pledge.rs repay_loan" },
  ],
} as const;

export type PledgeStatus = {
  token_id: string;
  owner: string | null;
  control: Control;
  loan: Loan | null;
  locked: boolean;
  lending_enabled: boolean | null;
  network: string | null;
  refused_while_locked: readonly (typeof LIEN_REFUSALS)[number][];
  default_path: { who: string; when: string; lender: string | null; due_ns: string | null; grace_sec: string | null } | null;
  note: string;
};

export function validKeyId(id: string): boolean {
  return KEY_ID.test(id);
}

/** Views only. Throws on an invalid id or a control state that was not read; nothing is guessed. */
export async function pledgeStatus(tokenId: string, view: View = contractView): Promise<PledgeStatus> {
  if (!validKeyId(tokenId)) throw new Error("bad key id: expected k + 16 lowercase hex (for example k5f4750858f328940) or a legacy number");
  const [owner, control, loan, config] = await Promise.all([
    view<{ owner_id: string } | null>("nft_token", { token_id: tokenId }),
    view<Control | null>("get_control_state", { token_id: tokenId }),
    view<Loan | null>("get_loan", { token_id: tokenId }),
    view<PledgeConfig>("get_pledge_config", {}),
  ]);
  if (!control || typeof control !== "object") throw new Error("control state not read for this key; it may not exist on this contract");
  const pendingOps = control.pending_value_ops !== "0";
  const locked = !!(control.pledged || loan !== null || control.listed || control.transfer_pending || pendingOps);
  // The default path exists only for an Active loan: the lender can move the key only after due + grace.
  const active = loan !== null && loan.state === "Active";
  const refusalsApply = !!control.pledged || loan !== null;
  return {
    token_id: tokenId,
    owner: owner?.owner_id ?? null,
    control,
    loan,
    locked,
    lending_enabled: config ? config.lending_enabled : null,
    network: config ? config.network : null,
    refused_while_locked: refusalsApply ? [...LIEN_REFUSALS] : [],
    default_path: active && loan ? { who: DEFAULT_PATH.who, when: DEFAULT_PATH.when, lender: loan.terms.lender, due_ns: loan.due_ns, grace_sec: loan.terms.grace_sec } : null,
    note: !config ? "Pledge config is not present on this contract."
      : config.lending_enabled ? `Lending is enabled on ${config.network}.`
      : `Lending is off on ${config.network}.`,
  };
}

/** Human summary for the CLI. */
export function renderPledgeStatus(s: PledgeStatus): string {
  const lines = [`key ${s.token_id}: ${s.locked ? "LOCKED" : "not locked"} (owner ${s.owner ?? "unknown"})`, s.note];
  if (s.loan) lines.push(`loan #${s.loan.nonce} state ${s.loan.state}; lender ${s.loan.terms.lender}; principal ${s.loan.terms.principal} yocto; due_ns ${s.loan.due_ns}; grace_sec ${s.loan.terms.grace_sec}`);
  if (s.refused_while_locked.length) {
    lines.push("refused while locked (paths read in the source, not a full audit):");
    for (const r of s.refused_while_locked) lines.push(`  ${r.action}: ${r.code} (${r.refused_by})`);
  }
  if (s.default_path) lines.push(`default: ${s.default_path.who}; ${s.default_path.when}`);
  return lines.join("\n");
}
