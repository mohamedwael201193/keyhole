/**
 * Typed client for the sealed bilateral Pledge surface on contracts/keys (oracle-free contract candidate).
 * Method names and argument shapes match contracts/keys/src/pledge.rs on that revision.
 * Live calls stay behind PLEDGE_LIVE; when the flag is off this module still exports the shapes
 * so the UI and unit tests can bind against the real contract API without talking to mainnet.
 */
import { KEYS_CONTRACT, PLEDGE_LIVE, RPC_URL } from "./config";

/** NEAR JSON stringified u128 / u64 wrappers as the contract serde uses them. */
export type U128 = string;
export type U64 = string;
export type TokenId = string;
export type AccountId = string;

export type LoanTerms = {
  lender: AccountId;
  principal: U128;
  repayment: U128;
  duration_sec: U64;
  grace_sec: U64;
  floor_raw: U128;
  funding_deadline_ns: U64;
};

export type LoanState =
  | "Freezing"
  | "Offered"
  | "Active"
  | "UnlockPending";

export type Loan = {
  token_id: TokenId;
  nonce: U64;
  borrower: AccountId;
  owner_epoch: U64;
  terms: LoanTerms;
  state: LoanState;
  due_ns: U64;
  storage_bond: U128;
  policy_sequence: U64;
  policy_busy: boolean;
  policy_call_complete: boolean;
  resolution: string | null;
};

export type PledgeConfig = {
  recovery_account: AccountId;
  recovery_unlock_ns: U64;
  attestor_public_key: string;
  custody_contract: AccountId;
  network: string;
  lending_enabled: boolean;
  next_loan_nonce: U64;
  next_payout_nonce: U64;
  treasury_available: U128;
  user_liabilities: U128;
  treasury_pending: PendingPayout | null;
};

export type PendingPayout = { nonce: U64; amount: U128 };

export type CollateralBinding = {
  wallet_pubkey: string;
  encrypted_policy_hash: string;
  policy_version: U64;
  /** LOCAL command sequence, not a provider generation guarantee. */
  policy_generation: U64;
  ready: boolean;
};

export type LoanCertificate = {
  domain: string;
  network: string;
  contract: AccountId;
  token_id: TokenId;
  loan_nonce: U64;
  borrower: AccountId;
  owner_epoch: U64;
  terms: LoanTerms;
  asset: string;
  wallet_pubkey: string;
  policy_version: U64;
  policy_hash: string;
  observed_at_ns: U64;
  expires_at_ns: U64;
  floor_met: boolean;
  frozen: boolean;
  pending_value_ops: U64;
};

/** Change methods that open/fund/settle a loan (PR #184). Callbacks are private and omitted. */
export const PLEDGE_CHANGE_METHODS = [
  "migrate_pledge",
  "set_lending_enabled",
  "register_collateral",
  "open_loan",
  "fund_loan",
  "repay_loan",
  "cancel_loan",
  "claim_default",
  "claim_payout",
  "fund_treasury",
  "recover_treasury",
] as const;

/** View methods (PR #184). */
export const PLEDGE_VIEW_METHODS = [
  "get_pledge_config",
  "get_loan",
  "get_collateral_binding",
] as const;

export type PledgeChangeMethod = (typeof PLEDGE_CHANGE_METHODS)[number];
export type PledgeViewMethod = (typeof PLEDGE_VIEW_METHODS)[number];

export type OpenLoanArgs = { token_id: TokenId; terms: LoanTerms };
export type FundLoanArgs = {
  token_id: TokenId;
  nonce: U64;
  certificate: LoanCertificate;
  signature: string;
};
export type LoanRefArgs = { token_id: TokenId; nonce: U64 };
export type ClaimDefaultArgs = { token_id: TokenId; nonce: U64; receiver_id: AccountId };
export type RegisterCollateralArgs = {
  token_id: TokenId;
  wallet_pubkey: string;
  encrypted_data: string;
};

/** Build a FunctionCall payload for open_loan. Does not send. */
export function buildOpenLoan(args: OpenLoanArgs) {
  return { method: "open_loan" as const, args, deposit: "1", gas: String(100 * 10 ** 12) };
}
export function buildFundLoan(args: FundLoanArgs) {
  return { method: "fund_loan" as const, args, deposit: "0", gas: String(100 * 10 ** 12) };
}
export function buildRepayLoan(args: LoanRefArgs, repaymentYocto: U128) {
  return { method: "repay_loan" as const, args, deposit: repaymentYocto, gas: String(100 * 10 ** 12) };
}
export function buildCancelLoan(args: LoanRefArgs) {
  return { method: "cancel_loan" as const, args, deposit: "1", gas: String(50 * 10 ** 12) };
}
export function buildClaimDefault(args: ClaimDefaultArgs) {
  return { method: "claim_default" as const, args, deposit: "1", gas: String(100 * 10 ** 12) };
}
export function buildRegisterCollateral(args: RegisterCollateralArgs) {
  return { method: "register_collateral" as const, args, deposit: "1", gas: String(100 * 10 ** 12) };
}

export type PledgeClientOpts = {
  /** Override the live flag (tests). Defaults to PLEDGE_LIVE from config. */
  live?: boolean;
  contractId?: string;
  rpcUrl?: string;
  /** Injected view fn for tests. */
  view?: <T>(method: string, args: Record<string, unknown>) => Promise<T>;
};

function b64encode(s: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(s).toString("base64");
  return btoa(s);
}
function utf8FromBytes(bytes: number[]): string {
  const u = new Uint8Array(bytes);
  if (typeof Buffer !== "undefined") return Buffer.from(u).toString("utf8");
  return new TextDecoder().decode(u);
}

async function rpcView<T>(rpcUrl: string, contractId: string, method: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "pledge",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contractId,
        method_name: method,
        args_base64: b64encode(JSON.stringify(args)),
      },
    }),
  });
  if (!res.ok) throw new Error(`rpc HTTP ${res.status}`);
  const j = (await res.json()) as { result?: { result?: number[] }; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message || "rpc error");
  const bytes = j.result?.result;
  if (!bytes) throw new Error("empty view result");
  return JSON.parse(utf8FromBytes(bytes)) as T;
}

/**
 * Typed Pledge client. When `live` is false (production default), view helpers refuse to
 * present chain data as live balances — callers must treat the UI as a labelled preview.
 */
export function createPledgeClient(opts: PledgeClientOpts = {}) {
  const live = opts.live ?? PLEDGE_LIVE;
  const contractId = opts.contractId ?? KEYS_CONTRACT;
  const rpcUrl = opts.rpcUrl ?? RPC_URL;
  const viewFn = opts.view ?? (<T,>(method: string, args: Record<string, unknown>) => rpcView<T>(rpcUrl, contractId, method, args));

  return {
    live,
    contractId,
    methods: { change: PLEDGE_CHANGE_METHODS, view: PLEDGE_VIEW_METHODS },
    buildOpenLoan,
    buildFundLoan,
    buildRepayLoan,
    buildCancelLoan,
    buildClaimDefault,
    buildRegisterCollateral,
    /** True only when the feature flag allows live reads/writes. */
    canTransact(): boolean {
      return live;
    },
    async getPledgeConfig(): Promise<PledgeConfig | null> {
      if (!live) return null;
      return viewFn<PledgeConfig | null>("get_pledge_config", {});
    },
    async getLoan(token_id: TokenId): Promise<Loan | null> {
      if (!live) return null;
      return viewFn<Loan | null>("get_loan", { token_id });
    },
    async getCollateralBinding(token_id: TokenId): Promise<CollateralBinding | null> {
      if (!live) return null;
      return viewFn<CollateralBinding | null>("get_collateral_binding", { token_id });
    },
  };
}

export type PledgeClient = ReturnType<typeof createPledgeClient>;

/** CTA copy when lending is gated behind audit. */
export const PLEDGE_CTA_DISABLED = "Pledge launches after audit";

/** Banner label for the preview (flag off). Never say "live". */
export const PLEDGE_PREVIEW_LABEL = "Preview — in review · not live";
