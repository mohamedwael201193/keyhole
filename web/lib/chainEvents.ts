/**
 * NEP-297 `keyhole` events for one key. Pure: the route fetches Nearblocks receipts and an archival
 * transaction status, then this module keeps the logs that name the token.
 * Spec: https://github.com/near/NEPs/blob/master/neps/nep-0297.md
 */
export const KEY_ID = /^(k[a-z0-9]{4,39}|\d{1,9})$/i;

/** Methods that emit a sale or loan event carrying `token_id`. */
export const INDEXED_METHODS = [
  "nft_list",
  "nft_unlist",
  "nft_buy",
  "open_loan",
  "fund_loan",
  "repay_loan",
  "cancel_loan",
  "claim_default",
  "reclaim_unclaimed_principal",
] as const;

export type IndexedEvent = {
  event: string;
  standard: "keyhole";
  tx: string;
  atMs: number | null;
  data: Record<string, unknown>;
};

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

/** Every log string nested in an RPC transaction-status result. */
export function collectLogs(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const x of node) collectLogs(x, out);
    return out;
  }
  const rec = node as Record<string, unknown>;
  if (Array.isArray(rec.logs)) {
    for (const line of rec.logs) if (typeof line === "string") out.push(line);
  }
  for (const v of Object.values(rec)) collectLogs(v, out);
  return out;
}

type RawEvent = { event: string; data: Record<string, unknown> };

/** `EVENT_JSON` rows of standard `keyhole`. Malformed lines are skipped. */
export function parseKeyholeEvents(logs: readonly string[]): RawEvent[] {
  const out: RawEvent[] = [];
  for (const line of logs) {
    if (!line.startsWith("EVENT_JSON:")) continue;
    let j: { standard?: unknown; event?: unknown; data?: unknown };
    try { j = JSON.parse(line.slice("EVENT_JSON:".length)); } catch { continue; }
    if (j.standard !== "keyhole" || typeof j.event !== "string" || !Array.isArray(j.data)) continue;
    for (const row of j.data) {
      if (row && typeof row === "object") out.push({ event: j.event, data: row as Record<string, unknown> });
    }
  }
  return out;
}

export function eventMatchesToken(data: Record<string, unknown>, tokenId: string): boolean {
  if (data.token_id === tokenId) return true;
  return Array.isArray(data.token_ids) && data.token_ids.includes(tokenId);
}

/** Keep sale and loan events for one token, oldest first, one row per event name and tx. */
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
      out.push({ event: ev.event, standard: "keyhole", tx: row.tx, atMs: row.atMs, data: ev.data });
    }
  }
  out.sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0) || a.tx.localeCompare(b.tx) || a.event.localeCompare(b.event));
  return out;
}

function yoctoNear(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d+$/.test(v)) return null;
  const n = BigInt(v);
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
  collateral_ready: "Collateral ready",
};

/** A short title and a public detail line. Amounts stay in NEAR, never USD. */
export function describeChainEvent(e: IndexedEvent): { title: string; detail: string } {
  const d = e.data;
  const price = yoctoNear(d.price) ?? yoctoNear(d.principal) ?? yoctoNear(d.repayment);
  const parts = [
    price,
    who(d.seller) ? `seller ${who(d.seller)}` : "",
    who(d.buyer) ? `buyer ${who(d.buyer)}` : "",
    who(d.lender) ? `lender ${who(d.lender)}` : "",
    typeof d.nonce === "string" || typeof d.nonce === "number" ? `nonce ${d.nonce}` : "",
  ].filter(Boolean);
  return {
    title: TITLES[e.event] ?? e.event.replaceAll("_", " "),
    detail: parts.join(" · ") || "NEP-297 event",
  };
}
