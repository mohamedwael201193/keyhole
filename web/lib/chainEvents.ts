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

/**
 * Receipt methods that can execute a displayed event.
 * This is the call-graph closure of every displayed `emit_key_event` in `contracts/keys/src`:
 * private helpers such as `end_listing` and `settle_principal`, and the async callbacks that run them.
 * `web/tests/keyhole-events-source.test.ts` parses those sources and fails if this list drifts.
 * A method whose args carry `token_id` is filtered per key.
 */
export const TOKEN_METHODS = [
  "nft_list",
  "nft_unlist",
  "nft_buy",
  "nft_transfer",
  "nft_transfer_call",
  "nft_transfer_payout",
  "resolve_transfer_call",
  "restore_expired_transfer",
  "buy_sale",
  "open_loan",
  "fund_loan",
  "repay_loan",
  "cancel_loan",
  "claim_default",
  "reclaim_unclaimed_principal",
  "retry_loan_policy",
  "on_policy_action",
  "reconcile_loan_policy",
  "on_loan_policy",
  "register_collateral",
  "on_collateral_stored",
  "check_collateral",
  "on_collateral_checked",
] as const;

/**
 * Receipts whose args do not carry `token_id`. The event does.
 * `loan_principal_delivered` is logged on `on_payout` (the `claim_payout` callback) and on `reconcile_payout`.
 * The callback and the call that schedules it are both queried, so one missing index row does not drop the transaction.
 * These stay account scans: an argument without `token_id` is not an unreadable token.
 */
export const ACCOUNT_METHODS = ["claim_payout", "on_payout", "reconcile_payout"] as const;

export type IndexedEvent = {
  event: string;
  standard: "keyhole" | "nep171";
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

/** How a token-method argument reads. `other` is a different key. Anything we cannot decode is `unreadable`, not a different key. */
export type TokenArg = "match" | "other" | "unreadable";

function parseArgsObject(text: string): { token_id?: unknown } | null {
  try {
    const j = JSON.parse(text) as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) return null;
    return j as { token_id?: unknown };
  } catch {
    return null;
  }
}

/** Nearblocks sends decoded JSON. v3 transactions nest it under args_json. The RPC sends base64 of that JSON. A primitive or a broken encoding is unreadable. */
export function decodeCallArgs(args: unknown): { token_id?: unknown } | null {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const row = args as { token_id?: unknown; args_json?: unknown };
    if (row.args_json && typeof row.args_json === "object" && !Array.isArray(row.args_json)) return row.args_json as { token_id?: unknown };
    return row;
  }
  if (typeof args !== "string" || args.length === 0) return null;
  const direct = parseArgsObject(args);
  if (direct) return direct;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(args) || args.length % 4 !== 0) return null;
  try {
    const text = Buffer.from(args, "base64").toString("utf8");
    return text ? parseArgsObject(text) : null;
  } catch {
    return null;
  }
}

export function classifyTokenArg(args: unknown, tokenId: string): TokenArg {
  const decoded = decodeCallArgs(args);
  const token = decoded?.token_id;
  if (typeof token !== "string" || !KEY_ID.test(token)) return "unreadable";
  return token === tokenId ? "match" : "other";
}

/** Token id inside a function-call `args` value, or null when it is missing or unreadable. */
export function receiptToken(args: unknown): string | null {
  const token = decodeCallArgs(args)?.token_id;
  return typeof token === "string" && KEY_ID.test(token) ? token : null;
}

/** The key page's history state. Only a complete success may say there is no history. */
export function chainEventView(body: { ok?: unknown; complete?: unknown; events?: unknown } | null | undefined): {
  state: "ready" | "partial" | "unavailable";
  events: IndexedEvent[];
} {
  const events = Array.isArray(body?.events) ? body.events as IndexedEvent[] : [];
  if (body?.ok === true && body.complete === true) return { state: "ready", events };
  if (events.length) return { state: "partial", events };
  return { state: "unavailable", events: [] };
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
  nft_mint: "Minted",
  nft_transfer: "Transferred",
  nft_burn: "Burned",
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
    who(d.owner_id) ? `holder ${who(d.owner_id)}` : "",
    present(d.nonce) ? `nonce ${d.nonce}` : "",
    typeof d.resolution === "string" && d.resolution ? d.resolution : "",
  ].filter(Boolean);
  return { title, detail: parts.join(" · ") || "NEP-297 event" };
}
