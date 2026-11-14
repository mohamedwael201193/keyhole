/**
 * Loans showcase data — the two real NEAR mainnet loans (A repaid, B defaulted).
 * Every hash was re-verified against the Nearblocks API on 2026-11-14 (11 SUCCESS,
 * 1 FAILED first fund) at the block heights listed here. Nothing here is a live
 * balance: the reserves line is TEE-reported custody accounting, labelled as such.
 * No profit figure exists anywhere — the account's only income to date is the
 * 0.0001 NEAR of loan interest on Loan A.
 */

export const LOAN_TOKEN = "kae885635fb7065c2";
export const LOAN_TOKEN_TITLE = "KEYHOLE Key · Bronze";
export const LOAN_BORROWER = "4058dd7adc2cb7450f816c9b9eba1c1efe600b2346f75f19623965ad78981baa";
export const LOAN_LENDER = "0705fdc1581a35351453bd4625f22d0c41b2b9edc3e7bed860586623c6778228";
/** When the 12 hashes were last verified against the Nearblocks API. */
export const EVIDENCE_VERIFIED_AT = "14 Nov 2026, 16:35 UTC";
/** r9 worker attestation for the live build behind the loans. */
export const ATTESTATION_URL = "https://api.outlayer.ai/attestations/1392083";

export type LoanTx = {
  label: string;
  plain: string;
  hash: string;
  block: number;
  /** "2026-11-14 10:45:29" (UTC) as returned by the explorer API. */
  timeUtc: string;
  status: "SUCCESS" | "FAILED";
};

export type LoanShowcase = {
  nonce: number;
  outcome: "REPAID" | "DEFAULTED";
  principalNear: string;
  repaidNear: string | null;
  bondNear: string;
  floorUsdc: string;
  term: string;
  grace: string;
  txs: LoanTx[];
};

export const LOAN_A: LoanShowcase = {
  nonce: 1,
  outcome: "REPAID",
  principalNear: "0.01",
  repaidNear: "0.0101",
  bondNear: "0.009",
  floorUsdc: "0.50",
  term: "10 min",
  grace: "1 min",
  txs: [
    { label: "Open", plain: "The borrower opened the loan and pledged the key as collateral.", hash: "BSkutP8G6ZWtWahYisXai9k5V579otDKYRsYwWSkjXQx", block: 224503090, timeUtc: "2026-11-14 10:45:29", status: "SUCCESS" },
    { label: "Fund — first try failed", plain: "The lender's first funding attempt failed: the certificate had expired. No funds moved.", hash: "FBw6qwpXks9NX18uJcFbJzahEeU6kJQYAnanN7WnsB38", block: 224503251, timeUtc: "2026-11-14 10:47:01", status: "FAILED" },
    { label: "Fund", plain: "The lender funded the loan with a fresh certificate.", hash: "DJe2Q4CBu3CPgvTTXgg6sXSKwNSc2qvsw7qDfDMn9uNi", block: 224503346, timeUtc: "2026-11-14 10:47:53", status: "SUCCESS" },
    { label: "Claim principal", plain: "The borrower claimed the 0.01 NEAR principal.", hash: "4Nt7BWpNeQVf2NyBNZypnUA3SaGrcVNDdvBvu54QpMoh", block: 224503393, timeUtc: "2026-11-14 10:48:20", status: "SUCCESS" },
    { label: "Repay", plain: "The borrower repaid 0.0101 NEAR — principal plus 0.0001 interest.", hash: "5X1C2zvR9pg1j237AcVhp43PbBaaz5d1y81k7XqUT18c", block: 224503442, timeUtc: "2026-11-14 10:48:48", status: "SUCCESS" },
    { label: "Lender claim", plain: "The lender claimed the repaid 0.0101 NEAR.", hash: "DvCJPssHQpQQsPyifzF3Lv2ggrKLmCZBHn4hMSG1uLVn", block: 224503542, timeUtc: "2026-11-14 10:49:46", status: "SUCCESS" },
    { label: "Bond return", plain: "The borrower got the 0.009 NEAR bond back.", hash: "3Tf1ZxuuqLUFdPHBtE7AsyXDGYqFgWqMQzXBDYjinm97", block: 224503568, timeUtc: "2026-11-14 10:50:01", status: "SUCCESS" },
  ],
};

export const LOAN_B: LoanShowcase = {
  nonce: 2,
  outcome: "DEFAULTED",
  principalNear: "0.01",
  repaidNear: null,
  bondNear: "0.009",
  floorUsdc: "0.50",
  term: "10 min",
  grace: "1 min",
  txs: [
    { label: "Open", plain: "The borrower opened a second loan on the same key.", hash: "4dHXBPJdWPTAg2pgUc5Rg5EWuFoJnHHTqvFoq4PzPgmo", block: 224503654, timeUtc: "2026-11-14 10:50:52", status: "SUCCESS" },
    { label: "Fund", plain: "The lender funded the loan.", hash: "9XZ53tkXgfBzTsKKVGjRf8K18HLWxQpsB3qmNfwv9kNj", block: 224503740, timeUtc: "2026-11-14 10:51:42", status: "SUCCESS" },
    { label: "Claim principal", plain: "The borrower claimed the 0.01 NEAR principal.", hash: "GkADkw4Xb15xrxrNtpcC1iDtUCKMCP21pAtpnqeA3iQL", block: 224503769, timeUtc: "2026-11-14 10:51:58", status: "SUCCESS" },
    { label: "Default claim", plain: "The borrower did not repay. The lender claimed the loan — and the whole key moved to the lender.", hash: "CiPpm7SSVcU5do25NtjfdhUgjpFet3XUd4RFwRFaUEA6", block: 224503833, timeUtc: "2026-11-14 10:52:35", status: "SUCCESS" },
    { label: "Bond return", plain: "The borrower got the 0.009 NEAR bond back.", hash: "EcRiURh74f9zMBNk55XWECys2m5i2F3z47tgWDjzmsyM", block: 224503938, timeUtc: "2026-11-14 10:53:34", status: "SUCCESS" },
  ],
};

export const LOAN_TXS: LoanTx[] = [...LOAN_A.txs, ...LOAN_B.txs];

/** Exact all-in costs, measured on mainnet — not estimated. */
export const LOAN_COSTS: { cost: string; amount: string }[] = [
  { cost: "Mint (Bronze)", amount: "0.1 NEAR" },
  { cost: "Loan bond (refundable)", amount: "0.009 NEAR per loan" },
  { cost: "Loan interest", amount: "0.0001 NEAR on a 0.01 NEAR principal (repayment 0.0101 NEAR)" },
  { cost: "Payout-slot registration", amount: "0.0032 NEAR (320 bytes, nonrefundable)" },
];
export const LOAN_COSTS_NOTE =
  "The RPC cost estimate for a 200-Tgas call (~0.21 NEAR) far exceeds the actual spend (~0.03 NEAR). That is an RPC estimation quirk, not a real cost.";
export const LOAN_COSTS_NO_PROFIT =
  "There is no profit figure here because no profit has been measured on a live key over a meaningful period.";

/**
 * Value over time, token-0 vault — HISTORICAL attested reads only, never current values.
 * The 0.1 USDC move is a withdrawal (canary delivery to the developer wallet), not
 * trading profit. No profit number, no percentage, is shown or implied.
 */
export const VAULT_READS: { valueUsdc: string; wnear: string; date: string }[] = [
  { valueUsdc: "0.213652", wnear: "~0.04294", date: "14 Nov 2026, before 07:30 EET" },
  { valueUsdc: "0.113652", wnear: "~0.04294", date: "14 Nov 2026, ~07:30 EET" },
];

/**
 * Lender reserves — TEE-reported custody credit, NOT a live on-chain balance.
 * The loan wallet id is an enclave wallet id, not a NEAR account, so a public
 * balance read for it returns 0. The 0.899818 figure is the worker's own
 * accounting at funding (credit verified), dated 14 Nov 2026.
 */
export const RESERVES = {
  walletId: "e6184650-8e9b-482d-8cc3-983530f52cf0",
  custodyCreditUsdc: "0.899818",
  custodyCreditRaw: "899,818",
  floorUsdc: "0.50",
  reportedAt: "14 Nov 2026, at funding",
  pooledUsdc: "352.541527",
};

export function shortHash(hash: string): string {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

export function shortAccount(accountId: string): string {
  return `${accountId.slice(0, 8)}…`;
}

/** "2026-11-14 10:45:29" (UTC) -> "14 Nov 2026, 10:45 UTC". */
export function formatLoanTime(timeUtc: string): string {
  const [date, time] = timeUtc.split(" ");
  const [year, month, day] = date.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${months[month - 1]} ${year}, ${time.slice(0, 5)} UTC`;
}
