/**
 * NEP-297 `keyhole` 1.0.0 events for one key.
 * Logs are kept only from a finalized transaction's successful receipts whose executor is this contract.
 * Spec: https://nomicon.io/Standards/EventsFormat
 */
export const KEY_ID = /^(k[a-z0-9]{4,39}|\d{1,9})$/i;
export const KEYHOLE_EVENT_VERSION = "1.0.0";
/** Pages requested per method. A remaining cursor after this bound is an incomplete read, never a complete empty history. */
export const MAX_EVENT_PAGES = 4;
export const EVENT_PAGE_SIZE = 25;

/** Methods whose function-call args carry `token_id`. */
export const TOKEN_METHODS = [
  "nft_list",
  "nft_unlist",
  "nft_buy",
  "open_loan",
  "fund_loan",
  "repay_loan",
  "cancel_loan",
  "claim_default",
  "reclaim_unclaimed_principal",
  "on_loan_policy",
  "reconcile_loan_policy",
  "retry_loan_policy",
] as const;

/**
 * Account or nonce calls. `loan_principal_delivered` is emitted on the `claim_payout` callback
 * or on `reconcile_payout`, not on the earlier `fund_loan` receipt. Discovery is the event, not the args.
 */
export const ACCOUNT_METHODS = ["claim_payout", "reconcile_payout"] as const;

export type IndexedEvent = {
  event: string;
  standard: "keyhole";
  version: "1.0.0";
  tx: string;
  atMs: number | null;
  data: Record<string, unknown>;
};

export type HistoryState = {
  events: IndexedEvent[];
  /** Every requested page was read and every transaction status was final. */
  complete: boolean;
  /** A fetch, a non-2xx response, an RPC error, or a non-final status. Never cached as an empty history. */
  unavailable: boolean;
};

const REQUIRED: Record<string, readonly string[]> = {
  key_list: ["token_id", "seller", "price"],
  key_unlist: ["token_id", "seller"],
  key_sale: ["token_id", "seller", "buyer", "price", "royalty"],
  key_listing_stale: ["token_id", "seller"],
  loan_open: ["token_id", "nonce"],
  loan_fund: ["token_id", "nonce", "lender", "principal"],
  loan_repay: ["token_id", "nonce", "repayment"],
  loan_cancel: ["token_id", "nonce"],
  loan_default: ["token_id", "nonce", "receiver_id"],
  loan_reclaim: ["token_id", "nonce", "lender", "principal"],
  loan_principal_delivered: ["token_id", "nonce", "payout_nonce"],
  loan_closed: ["token_id", "nonce", "resolution"],
  collateral_ready: ["token_id", "wallet_pubkey"],
};

/** Contract events this page does not present as sale or loan history. The source scan must match this set plus REQUIRED. */
export const UNDISPLAYED_KEYHOLE_EVENTS = [
  "value_op_begin",
  "value_op_finish",
  "royalty_policy",
  "transfer_reservation_missing",
  "treasury_credit",
  "payout_storage_register",
  "lending_toggle",
  "payout_claim",
  "payout_reconciled",
  "payout_reconcile_refused",
  "treasury_reconciled",
  "treasury_reconcile_refused",
  "treasury_recover",
  "payout_apply_failed",
  "principal_cashout_failed",
  "principal_activation_refused",
  "treasury_apply_failed",
  "sale_policy_result_unknown",
  "protected_sale",
  "owner_proposed",
  "owner_proposal_cancelled",
  "upgrade_cancelled",
  "owner_changed",
  "upgrade_staged",
  "upgrade_applied",
  "wind_down",
] as const;

export const KEYHOLE_EVENT_FIELDS = REQUIRED;

/** A NEAR execution status that produced a value or a follow-up receipt. `Failure` is not included. */
export function outcomeSucceeded(status: unknown): boolean {
  if (!status || typeof status !== "object" || Array.isArray(status)) return false;
  const s = status as Record<string, unknown>;
  return typeof s.SuccessValue === "string" || typeof s.SuccessReceiptId === "string";
}

/**
 * Logs from `receipts_outcome` entries that executed on `contractId` and succeeded.
 * A later failed child does not drop an earlier successful contract receipt.
 * A foreign executor, a failed contract receipt, or a non-final transaction contributes nothing.
 */
export function authenticatedLogs(result: unknown, contractId: string): { final: boolean; logs: string[] } {
  if (!result || typeof result !== "object") return { final: false, logs: [] };
  const root = result as { final_execution_status?: unknown; receipts_outcome?: unknown };
  if (root.final_execution_status !== "FINAL" || !Array.isArray(root.receipts_outcome)) return { final: false, logs: [] };
  const logs: string[] = [];
  for (const item of root.receipts_outcome) {
    if (!item || typeof item !== "object") continue;
    const outcome = (item as { outcome?: unknown }).outcome;
    if (!outcome || typeof outcome !== "object") continue;
    const row = outcome as { executor_id?: unknown; status?: unknown; logs?: unknown };
    if (row.executor_id !== contractId || !outcomeSucceeded(row.status) || !Array.isArray(row.logs)) continue;
    for (const line of row.logs) if (typeof line === "string") logs.push(line);
  }
  return { final: true, logs };
}

function present(v: unknown): boolean {
  if (typeof v === "string") return v.length > 0;
  if (typeof v === "number") return Number.isFinite(v);
  return false;
}

/** Token id inside a Nearblocks function-call `args` string, or null. */
export function receiptToken(args: unknown): string | null {
  if (typeof args !== "string" || !args) return null;
  try {
    const j = JSON.parse(args) as { token_id?: unknown };
    return typeof j.token_id === "string" && KEY_ID.test(j.token_id) ? j.token_id : null;
  } catch {
    return null;
  }
}

type RawEvent = { event: string; data: Record<string, unknown> };

/** Verified `keyhole` 1.0.0 rows. Wrong version, unknown kind, or a missing required field is dropped. */
export function parseKeyholeEvents(logs: readonly string[]): RawEvent[] {
  const out: RawEvent[] = [];
  for (const line of logs) {
    if (!line.startsWith("EVENT_JSON:")) continue;
    let j: { standard?: unknown; version?: unknown; event?: unknown; data?: unknown };
    try { j = JSON.parse(line.slice("EVENT_JSON:".length)); } catch { continue; }
    if (j.standard !== "keyhole" || j.version !== KEYHOLE_EVENT_VERSION || typeof j.event !== "string") continue;
    const need = REQUIRED[j.event];
    if (!need || !Array.isArray(j.data)) continue;
    for (const row of j.data) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const data = row as Record<string, unknown>;
      if (!need.every((k) => present(data[k]))) continue;
      out.push({ event: j.event, data });
    }
  }
  return out;
}

export function eventMatchesToken(data: Record<string, unknown>, tokenId: string): boolean {
  if (data.token_id === tokenId) return true;
  return Array.isArray(data.token_ids) && data.token_ids.includes(tokenId);
}

/** Keep verified sale and loan events for one token, oldest first. */
export function eventsForToken(
  rows: readonly { tx: string; atMs: number | null; logs: readonly string[] }[],
  tokenId: string,
): IndexedEvent[] {
  const seen = new Set<string>();
  const out: IndexedEvent[] = [];
  for (const row of rows) {
    for (const ev of parseKeyholeEvents(row.logs)) {
      if (!eventMatchesToken(ev.data, tokenId)) continue;
      const key = `${row.tx}|${ev.event}|${JSON.stringify(ev.data)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ event: ev.event, standard: "keyhole", version: "1.0.0", tx: row.tx, atMs: row.atMs, data: ev.data });
    }
  }
  out.sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0) || a.tx.localeCompare(b.tx) || a.event.localeCompare(b.event));
  return out;
}

export type ReceiptPage = { txns: unknown[]; cursor: string | null };

/** Whether another page should be requested. A full page with a cursor past the bound is incomplete. */
export function pageStep(page: ReceiptPage, index: number, maxPages = MAX_EVENT_PAGES): { stop: boolean; complete: boolean; cursor: string | null } {
  const cursor = page.cursor;
  if (!cursor || page.txns.length < EVENT_PAGE_SIZE) return { stop: true, complete: true, cursor: null };
  if (index + 1 >= maxPages) return { stop: true, complete: false, cursor };
  return { stop: false, complete: false, cursor };
}

function yoctoNear(v: unknown): string | null {
  const raw = typeof v === "number" ? String(v) : v;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const n = BigInt(raw);
  const whole = n / 10n ** 24n;
  const frac = (n % 10n ** 24n).toString().padStart(24, "0").replace(/0+$/, "");
  return `${frac ? `${whole}.${frac}` : whole} NEAR`;
}

function who(v: unknown): string {
  return typeof v === "string" && v ? `${v.slice(0, 8)}…${v.slice(-4)}` : "";
}

const TITLES: Record<string, string> = {
  key_list: "Listed for sale",
  key_unlist: "Listing removed",
  key_sale: "Sold",
  key_listing_stale: "Stale listing cleared",
  loan_open: "Loan opened",
  loan_fund: "Loan funded",
  loan_repay: "Loan repaid",
  loan_cancel: "Loan cancelled",
  loan_default: "Loan defaulted",
  loan_reclaim: "Unclaimed principal reclaimed",
  loan_principal_delivered: "Principal delivered",
  loan_closed: "Loan closed",
  collateral_ready: "Collateral ready",
};

export const EVENT_TITLES = TITLES;

/** A short title and a public detail line. Unknown kinds are not labelled as verified history. */
export function describeChainEvent(e: IndexedEvent): { title: string; detail: string } | null {
  const title = TITLES[e.event];
  if (!title || e.version !== KEYHOLE_EVENT_VERSION) return null;
  const d = e.data;
  const price = yoctoNear(d.price) ?? yoctoNear(d.principal) ?? yoctoNear(d.repayment);
  const parts = [
    price,
    who(d.seller) ? `seller ${who(d.seller)}` : "",
    who(d.buyer) ? `buyer ${who(d.buyer)}` : "",
    who(d.lender) ? `lender ${who(d.lender)}` : "",
    present(d.nonce) ? `nonce ${d.nonce}` : "",
    typeof d.resolution === "string" && d.resolution ? d.resolution : "",
  ].filter(Boolean);
  return { title, detail: parts.join(" · ") || "NEP-297 event" };
}
