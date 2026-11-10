/**
 * Typed client for the sealed bilateral Pledge surface on contracts/keys (PR #184 prepaid-slot head 92da286 + delivery-clock loan-limits candidate).
 * Method names and argument shapes match contracts/keys/src/pledge.rs on that revision.
 * Live calls stay behind PLEDGE_LIVE; when the flag is off this module still exports the shapes
 * so the UI and unit tests can bind against the real contract API without talking to mainnet.
 */
import type {KeysCall} from "./keysTx";
import { KEYS_CONTRACT, PLEDGE_LIVE, PLEDGE_TRANSACTIONS, RPC_URL } from "./config";

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

export type LoanState = "Freezing" | "Offered" | "DisbursementPending" | "Active" | "UnlockPending";

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

export type PendingPayout = {nonce: U64; amount: U128};

export type CollateralBinding = {
  wallet_pubkey: string;
  encrypted_policy_hash: string;
  policy_version: U64;
  /** Local sequence, not a provider generation guarantee. */
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
  "register_payout_account",
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
  "payout_storage_cost",
  "payout_account_registered",
  "get_loan",
  "get_collateral_binding",
  "get_loan_limits",
  "get_lender_offer",
  "get_payout_credit",
  "get_pending_payout",
  "get_principal_delivery",
  "loan_certificate_template",
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
  wallet_signature: string;
  version: number;
  valid_until: number;
};

/** Build a FunctionCall payload for open_loan. Does not send. */
export function buildOpenLoan(args: OpenLoanArgs, storageBondYocto: U128) {
  if (!/^\d+$/.test(storageBondYocto) || BigInt(storageBondYocto) <= 0n) throw Error("Read exact storage bond from get_loan_limits");
  return { method: "open_loan" as const, args, deposit: storageBondYocto, gas: "200000000000000" };
}
export function buildFundLoan(args: FundLoanArgs) {
  return { method: "fund_loan" as const, args, deposit: args.certificate.terms.principal, gas: "200000000000000" };
}
export function buildRepayLoan(args: LoanRefArgs, repaymentYocto: U128) {
  return { method: "repay_loan" as const, args, deposit: repaymentYocto, gas: "200000000000000" };
}
export function buildCancelLoan(args: LoanRefArgs) {
  return { method: "cancel_loan" as const, args, deposit: "1", gas: "200000000000000" };
}
export function buildClaimDefault(args: ClaimDefaultArgs) {
  return { method: "claim_default" as const, args, deposit: "1", gas: "200000000000000" };
}
export function buildRegisterCollateral(args: RegisterCollateralArgs, policyAndBindingDeposit: U128) {
  if (!/^\d+$/.test(policyAndBindingDeposit) || BigInt(policyAndBindingDeposit) <= 0n) throw Error("Exact provider plus binding deposit required");
  return { method: "register_collateral" as const, args, deposit: policyAndBindingDeposit, gas: "200000000000000" };
}

export type LoanLimits = { storage_bond: U128; collateral_binding_deposit: U128; min_duration_sec: U64; max_duration_sec: U64; max_grace_sec: U64; certificate_max_age_ns: U64; activation: string };
export type LenderOffer = { loan: Loan; asset: string; decimals: number; lender_has_no_key: boolean; lender_has_no_return_reservation: boolean; lending_enabled: boolean; owner_current: boolean; funding_open: boolean; certificate_required: boolean };
export function buildClaimPayout() { return {method: "claim_payout" as const, args: {}, deposit: "1", gas: "200000000000000"}; }

/** Single-line consent. Never call the permanent charge a refundable bond or principal deduction. */
export function payoutStorageConsent(cost: U128 | null): string {
  if (cost === null) return "One-time payout storage: exact fee quoted before your first action; nonrefundable and reusable (0.0032 NEAR at the tested byte price).";
  if (!/^\d+$/.test(cost)) throw Error("Invalid payout storage quote");
  const n=BigInt(cost);
  if(n===0n)return "Payout storage is already registered; no new fee.";
  const near=`${n/10n**24n}.${(n%10n**24n).toString().padStart(24,"0").replace(/0+$/,"")||"0"}`;
  return `One-time payout storage: ${near} NEAR, nonrefundable and reusable; included in this transaction.`;
}
export type PledgeActionPlan = {calls: KeysCall[]; payoutStorageChargeYocto: U128; totalDepositYocto: U128};
export function buildRegisterPayoutAccount(account: AccountId, exactCost: U128): KeysCall {
  if (typeof exactCost !== "string" || !/^\d+$/.test(exactCost) || BigInt(exactCost) <= 0n || BigInt(exactCost) >= 1n << 128n) throw Error("Read exact payout storage cost from the final chain");
  return {method: "register_payout_account", args: {account_id: account}, deposit: exactCost, gas: "20000000000000"};
}

export type PledgeClientOpts = {
  /** Override the live flag (tests). Defaults to PLEDGE_LIVE from config. */
  live?: boolean;
  transactionsEnabled?: boolean;
  chainNowNs?: () => Promise<U64>;
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
    rpcUrl,
    async chainNowNs():Promise<U64>{
      if(!live)throw Error("Preview has no live clock");
      if(opts.chainNowNs)return opts.chainNowNs();
      const response=await fetch(rpcUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:"pledge-clock",method:"block",params:{finality:"final"}})});
      const j=await response.json();const n=j.result?.header?.timestamp_nanosec;
      if(!response.ok||j.error||typeof n!=="string"||!/^\d+$/.test(n))throw Error("Final chain clock unavailable");
      return n;
    },
    methods: { change: PLEDGE_CHANGE_METHODS, view: PLEDGE_VIEW_METHODS },
    buildOpenLoan,
    buildFundLoan,
    buildRepayLoan,
    buildCancelLoan,
    buildClaimDefault,
    buildRegisterCollateral,
    buildClaimPayout,
    buildRegisterPayoutAccount,
    async getPayoutStorageCost(): Promise<U128 | null> {return live ? viewFn<U128>("payout_storage_cost", {}) : null;},
    async payoutAccountRegistered(account_id: AccountId): Promise<boolean | null> {return live ? viewFn<boolean>("payout_account_registered", {account_id}) : null;},
    /** Build, do not send. Fee must be displayed for consent. Missing ABI/status fails closed. */
    async prepareAction(account: AccountId, action: KeysCall): Promise<PledgeActionPlan> {
      if (!live) throw Error("Preview cannot prepare a money operation");
      if (!["register_collateral","open_loan","fund_loan","repay_loan","cancel_loan","claim_default","claim_payout"].includes(action.method)) throw Error("Only a credit-producing Pledge role can buy payout storage in this planner");
      if (!/^[a-z0-9]+([._-][a-z0-9]+)*$/.test(account) || account.length < 2 || account.length > 64 || /^0x[0-9a-f]{40}$/i.test(account)) throw Error("Native NEAR identity required");
      const registered = await viewFn<boolean>("payout_account_registered", {account_id: account});
      if (typeof registered !== "boolean") throw Error("Final payout registration status unavailable");
      const registration = registered ? [] : [buildRegisterPayoutAccount(account, await viewFn<U128>("payout_storage_cost", {}))];
      const calls = [...registration, action];
      if (calls.reduce((n, c) => n + BigInt(c.gas), 0n) > 300_000_000_000_000n) throw Error("Atomic first action exceeds the gas budget");
      return {calls, payoutStorageChargeYocto: registration[0]?.deposit ?? "0", totalDepositYocto: calls.reduce((n, c) => n + BigInt(c.deposit), 0n).toString()};
    },
    async getPrincipalDelivery(account_id:AccountId):Promise<{token_id:TokenId;loan_nonce:U64;principal:U128;payout_nonce:U64|null}|null>{return live?viewFn("get_principal_delivery",{account_id}):null;},
    async getCertificateTemplate(token_id:TokenId,observed_at_ns:U64,expires_at_ns:U64):Promise<LoanCertificate|null>{return live?viewFn("loan_certificate_template",{token_id,observed_at_ns,expires_at_ns}):null;},
    async getLoanLimits(): Promise<LoanLimits | null> { return live ? viewFn<LoanLimits>("get_loan_limits", {}) : null; },
    async getLenderOffer(token_id: TokenId): Promise<LenderOffer | null> { return live ? viewFn<LenderOffer | null>("get_lender_offer", {token_id}) : null; },
    async getPayoutCredit(account_id: AccountId): Promise<U128 | null> { return live ? viewFn<U128>("get_payout_credit", {account_id}) : null; },
    async getPendingPayout(account_id: AccountId): Promise<{nonce: U64; amount: U128} | null> { return live ? viewFn<{nonce: U64; amount: U128} | null>("get_pending_payout", {account_id}) : null; },
    /** Read-only candidate: stays false until separate certificate/wallet release review. */
    canTransact(): boolean {
      return live && (opts.transactionsEnabled ?? PLEDGE_TRANSACTIONS);
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
