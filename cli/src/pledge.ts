// Read-only lien status for one key: views only, no signature, no transaction.
// The refusal list is copied from the code the chain and the enclave run (see the `source` fields), so an agent
// can see exactly which actions a pledged key cannot take before it tries one.
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

/** Actions refused while a loan is open. `source` names the exact file and the string the code returns. */
export const LIEN_REFUSALS = [
  { action: "transfer", refused_by: "contract", code: "pledged: ownership and value operations locked", source: "contracts/keys/src/pledge.rs assert_token_idle (nft_transfer, nft_transfer_call, nft_transfer_payout)" },
  { action: "list", refused_by: "contract", code: "pledged: ownership and value operations locked", source: "contracts/keys/src/pledge.rs assert_token_idle (nft_list)" },
  { action: "sale", refused_by: "contract", code: "pledged: ownership and value operations locked", source: "contracts/keys/src/pledge.rs assert_token_idle (open_sale via assert_can_change_owner)" },
  { action: "withdraw", refused_by: "enclave", code: "pledged", message: "pledged: all custody value operations are locked", source: "tee/worker/src/guarded.rs GuardControl.admit" },
  { action: "swap", refused_by: "enclave", code: "pledged", message: "pledged: all custody value operations are locked", source: "tee/worker/src/guarded.rs GuardControl.admit" },
  { action: "copy", refused_by: "enclave", code: "pledged", message: "pledged: all custody value operations are locked", source: "tee/worker/src/guarded.rs GuardControl.admit" },
  { action: "withdraw_dry_run", refused_by: "enclave", code: "pledged", message: "pledged: all custody value operations are locked", source: "tee/worker/src/guarded_host.rs guard_preflight" },
] as const;

/** Who may move the key under the loan. Only the borrower-signed terms; read from get_loan, not from this code. */
export const DEFAULT_PATH = {
  who: "the lender named in get_loan terms.lender, and nobody else",
  when: "loan state Active, and block time after due_ns + grace_sec (repay_loan is refused after that point)",
  refusals: [
    { code: "only lender", source: "contracts/keys/src/pledge.rs claim_default" },
    { code: "loan not active", source: "contracts/keys/src/pledge.rs claim_default" },
    { code: "default not due", source: "contracts/keys/src/pledge.rs claim_default" },
    { code: "distinct external receiver required", source: "contracts/keys/src/pledge.rs claim_default" },
    { code: "default claim period", source: "contracts/keys/src/pledge.rs repay_loan (after grace)" },
  ],
} as const;

export type PledgeStatus = {
  token_id: string;
  owner: string | null;
  control: Control | null;
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

/** Views only. Throws on an invalid id; an unknown key is reported as a thrown error from the contract, not guessed. */
export async function pledgeStatus(tokenId: string, view: View = contractView): Promise<PledgeStatus> {
  if (!validKeyId(tokenId)) throw new Error("bad key id: expected k + hex (for example k5f4750858f328940) or a legacy number");
  const [owner, control, loan, config] = await Promise.all([
    view<{ owner_id: string } | null>("nft_token", { token_id: tokenId }),
    view<Control>("get_control_state", { token_id: tokenId }),
    view<Loan | null>("get_loan", { token_id: tokenId }),
    view<PledgeConfig>("get_pledge_config", {}),
  ]);
  const locked = !!control.pledged || loan !== null || control.listed || control.transfer_pending || control.pending_value_ops !== "0";
  // The default path exists only for an Active loan: the lender can move the key only after due + grace.
  const active = loan !== null && loan.state === "Active";
  return {
    token_id: tokenId,
    owner: owner?.owner_id ?? null,
    control,
    loan,
    locked,
    lending_enabled: config ? config.lending_enabled : null,
    network: config ? config.network : null,
    refused_while_locked: locked ? [...LIEN_REFUSALS] : [],
    default_path: active && loan ? { who: DEFAULT_PATH.who, when: DEFAULT_PATH.when, lender: loan.terms.lender, due_ns: loan.due_ns, grace_sec: loan.terms.grace_sec } : null,
    note: !config ? "Pledge config is not present on this contract." : config.lending_enabled ? "Lending is enabled on this contract." : "Lending is off on this contract.",
  };
}

/** Human summary for the CLI and the MCP text result. */
export function renderPledgeStatus(s: PledgeStatus): string {
  const lines = [`key ${s.token_id}: ${s.locked ? "LOCKED" : "not locked"} (owner ${s.owner ?? "unknown"})`, s.note];
  if (s.loan) lines.push(`loan #${s.loan.nonce} state ${s.loan.state}; lender ${s.loan.terms.lender}; principal ${s.loan.terms.principal} yocto; due_ns ${s.loan.due_ns}; grace_sec ${s.loan.terms.grace_sec}`);
  if (s.refused_while_locked.length) {
    lines.push("refused while locked:");
    for (const r of s.refused_while_locked) lines.push(`  ${r.action}: ${r.code} (${r.refused_by})`);
  }
  if (s.default_path) lines.push(`default: ${s.default_path.who}; ${s.default_path.when}`);
  return lines.join("\n");
}
