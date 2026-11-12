/**
 * The rules behind the Activity page (/settle). Pure: no React, no fetch, no clock (the caller passes `now`), so each rule has
 * a unit test (tests/activity-orders.test.ts). Sources: the live 1Click status (GET /api/oneclick, normalised by its route),
 * lib/settlements.ts (SETTLEMENTS, VAULT_TRADE) and the 1Click asset list (OC_ASSETS). A value that was not read stays missing;
 * nothing here invents a count, a percentage, a time or a hash.
 */
import { intentTx, tx, txAlt } from "@/lib/config";
import { STATUS, assetById, fundsStep, statusOf, type OcAsset } from "@/lib/oneclick";
import { amountText, entryDetail, kindLabel, type HistEntry } from "@/lib/dashboard";
import { SETTLEMENTS, VAULT_TRADE, type Settlement } from "@/lib/settlements";

export type VaultTrade = typeof VAULT_TRADE;

/** A transaction hash as 1Click returns it: a bare string, or { hash, explorerUrl } (explorerUrl is often empty). */
export type HashRef = { hash: string; explorerUrl: string | null };

/** The status read for one order: the JSON of GET /api/oneclick (app/api/oneclick/route.ts). */
export type LiveStatus = {
  status?: string;
  updatedAt?: string;
  details: {
    depositedAmountFormatted?: string | null;
    amountOutFormatted?: string | null;
    refundedAmountFormatted?: string | null;
    nearTxHashes?: unknown[];
    intentHashes?: unknown[];
    destinationChainTxHashes?: unknown[];
    originChainTxHashes?: unknown[];
  };
};

/** Where one order's read stands. "recorded" is the vault trade, whose record lives in lib/settlements.ts. */
export type OrderRead =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ok"; live: LiveStatus }
  | { state: "recorded" }
  /** One entry of the holder's signed history for this key, from the attested call `callId`. */
  | { state: "signed"; entry: HistEntry; callId: string };

export type OrderRow = {
  /** Selection key: the 1Click deposit address, or the enclave call id of the vault trade. */
  id: string;
  /** "mine": an entry of the holder's own signed history (the "Your vault" source). */
  kind: "live" | "vault" | "mine";
  title: string;
  settlement: Settlement | null;
  read: OrderRead;
  /** The 1Click status word. "SUCCESS" for the recorded vault trade. null while loading, unreadable or not a known word. */
  status: string | null;
  from: OcAsset | null;
  to: OcAsset | null;
};

/**
 * The 1Click assets each order moved between, keyed by deposit address (live orders) or call id (the vault trade). Every id is
 * an asset in OC_ASSETS; a test checks that, so a renamed asset cannot silently drop a token mark.
 */
const WNEAR = "nep141:wrap.near";
const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDC_BASE = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const SOL = "nep141:sol.omft.near";
export const ROUTES: Readonly<Record<string, { from: string; to: string }>> = {
  "8ce897e4047c1aa01f9c7c3e92b6392e424fa9e9564153a5c1f0ac563706cc45": { from: WNEAR, to: USDC_NEAR },
  "15a7f92d61890a802f33d08c631c4f4b7a5c185f336134cb3ae4a70984686794": { from: USDC_NEAR, to: WNEAR },
  "0xF60390Eb2309c39A5Dc39a619352fCffe83105d6": { from: USDC_BASE, to: SOL },
  "6pvcZZ2xMUhDpQmySGaVR2Cm9e3Aixx5QUQUPS7RAcha": { from: SOL, to: USDC_NEAR },
  "5sESFfrM4Tk6L5euDCTjjMxVAs5xmbZpj4i3V29s3KJ": { from: SOL, to: USDC_NEAR },
  [VAULT_TRADE.callId]: { from: USDC_NEAR, to: WNEAR },
};

const nz = (v: string | null | undefined): string | null => (v && Number(v) !== 0 ? v : null);
const routeOf = (id: string) => {
  const r = ROUTES[id];
  return { from: r ? (assetById(r.from) ?? null) : null, to: r ? (assetById(r.to) ?? null) : null };
};

/** The 1Click status word of a read, or null: only the words 1Click documents (lib/oneclick STATUS) count. */
function statusOfRead(read: OrderRead): string | null {
  if (read.state === "recorded") return "SUCCESS";
  if (read.state !== "ok") return null;
  const s = read.live.status;
  return typeof s === "string" && Object.hasOwn(STATUS, s) ? s : null;
}

/** The rows of the page, in order: the recorded vault trade first, then the listed 1Click orders. Pure. */
export function buildOrders(
  reads: Readonly<Record<string, OrderRead | undefined>>,
  settlements: readonly Settlement[] = SETTLEMENTS,
  vault: VaultTrade = VAULT_TRADE,
): OrderRow[] {
  const vaultRow: OrderRow = {
    id: vault.callId, kind: "vault", title: `${vault.amountIn} → ${vault.amountOut}`, settlement: null,
    read: { state: "recorded" }, status: "SUCCESS", ...routeOf(vault.callId),
  };
  const live = settlements.map((s): OrderRow => {
    const read: OrderRead = reads[s.depositAddress] ?? { state: "loading" };
    return { id: s.depositAddress, kind: "live", title: s.label, settlement: s, read, status: statusOfRead(read), ...routeOf(s.depositAddress) };
  });
  return [vaultRow, ...live];
}

export const liveOf = (row: OrderRow): LiveStatus | null => (row.read.state === "ok" ? row.read.live : null);

/* ---------- Buckets, counts, shares ---------- */

/** Settled, refunded, failed (the three filters), open (a known status still moving), unread (not read, or not a known word). */
export type Bucket = "settled" | "refunded" | "failed" | "open" | "unread";
export function bucketOf(row: OrderRow): Bucket {
  if (row.read.state === "signed") return mineWordOf(row.read.entry)?.bucket ?? "unread";
  switch (row.status) {
    case "SUCCESS": return "settled";
    case "REFUNDED": return "refunded";
    case "FAILED": return "failed";
    case null: return "unread";
    default: return "open";
  }
}

export type Counts = {
  total: number;
  /** Orders whose status is known (settled, refunded, failed or open). The denominator of every share. */
  read: number;
  settled: number;
  refunded: number;
  failed: number;
  open: number;
  /** Still being read from 1Click. */
  loading: number;
  /** The read failed, or returned a status word that is not one 1Click documents. */
  unavailable: number;
};

/** Counts from the real rows. An order still loading or unreadable is never counted as a status it does not have. */
export function countsOf(rows: readonly OrderRow[]): Counts {
  const c: Counts = { total: rows.length, read: 0, settled: 0, refunded: 0, failed: 0, open: 0, loading: 0, unavailable: 0 };
  for (const r of rows) {
    const b = bucketOf(r);
    if (b === "unread") {
      if (r.read.state === "loading") c.loading++;
      else c.unavailable++;
      continue;
    }
    c.read++;
    c[b]++;
  }
  return c;
}

/** A share of the read orders, to one decimal (75, 16.7, 8.3), or null when no order is read yet. */
export function shareOf(part: number, read: number): number | null {
  if (read <= 0) return null;
  return Math.round((part / read) * 1000) / 10;
}
/** The share as text ("75%", "16.7%"), or null when there is nothing to divide by. */
export function shareText(part: number, read: number): string | null {
  const v = shareOf(part, read);
  if (v === null) return null;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

/* ---------- Chips, marks, row text ---------- */

export type ChipTone = "success" | "warn" | "error" | "info" | "neutral";
/** The status chip: the 1Click word and its tone, or the honest state while the order is not read. */
export function chipOf(row: OrderRow): { tone: ChipTone; label: string } {
  if (row.read.state === "signed") {
    const e = row.read.entry;
    return { tone: TONE_BY_BUCKET[bucketOf(row)], label: mineWordOf(e)?.label ?? (e.status ? String(e.status) : "No status") };
  }
  if (row.status) {
    const s = statusOf(row.status);
    const tone: ChipTone = s.tone === "ok" ? "success" : s.tone === "bad" ? "error" : s.tone === "warn" ? "warn" : "info";
    return { tone, label: s.label };
  }
  if (row.read.state === "loading") return { tone: "neutral", label: "Checking" };
  if (row.read.state === "error") return { tone: "neutral", label: "Not read" };
  return { tone: "neutral", label: "Not recognised" };
}

/** The round icon of a row: the colour and the glyph for its bucket. */
export function markOf(row: OrderRow): { tone: "success" | "warn" | "error" | "primary" | "neutral"; icon: "check" | "arrow-down" | "x" | "activity" | "alert" } {
  switch (bucketOf(row)) {
    case "settled": return { tone: "success", icon: "check" };
    case "refunded": return { tone: "warn", icon: "arrow-down" };
    case "failed": return { tone: "error", icon: "x" };
    case "open": return { tone: "primary", icon: "activity" };
    default: return row.read.state === "error" ? { tone: "neutral", icon: "alert" } : { tone: "neutral", icon: "activity" };
  }
}

/** A 1Click asset as its symbol, its chain name (from the OC_ASSETS label) and its chain id (for the token mark). */
export function assetParts(a: OcAsset | null): { symbol: string; chainName: string; chainId: string; assetId: string } | null {
  if (!a) return null;
  const [symbol, chainName] = a.label.split(" · ");
  return { symbol, chainName: chainName ?? a.chain, chainId: a.chain, assetId: a.id };
}

/** The sub line of a list row. Words come from the live read or the recorded quote; nothing is estimated. */
export function subOf(row: OrderRow): string {
  if (row.read.state === "signed") return entryDetail(row.read.entry);
  if (row.kind === "vault") return "Swapped inside the key's sealed account";
  if (row.read.state === "loading") return "Reading the live status from 1Click";
  if (row.read.state === "error") return "Live status unavailable. Open the order to try again.";
  const live = liveOf(row);
  if (!live) return "Status not recognised";
  const from = assetParts(row.from)?.symbol ?? "";
  const to = assetParts(row.to)?.symbol ?? "";
  const b = bucketOf(row);
  if (b === "settled" && live.details.amountOutFormatted) return `${live.details.amountOutFormatted} ${to} received`.trim();
  if ((b === "refunded" || b === "failed") && nz(live.details.refundedAmountFormatted)) return `${live.details.refundedAmountFormatted} ${from} returned`.trim();
  return row.settlement?.quote ?? "";
}

/** The time of a live read (its last status change), or null when there is none. The recorded vault trade has no time. */
export function timeOf(row: OrderRow): number | null {
  if (row.read.state === "signed") {
    const t = row.read.entry.ts_ms;
    return typeof t === "number" && Number.isFinite(t) && t > 0 ? t : null;
  }
  const live = liveOf(row);
  if (!live?.updatedAt) return null;
  const t = Date.parse(live.updatedAt);
  return Number.isFinite(t) ? t : null;
}

const TZ = "Africa/Cairo";
/** "2 Nov, 19:21" (the time zone the mockups use). */
export function whenShort(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ });
}
/** "2 Nov 2026, 19:21 (UTC+2)". */
export function whenLong(iso: string): string {
  return `${new Date(iso).toLocaleString("en-GB", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ })} (UTC+2)`;
}

/** The meta line on the right of a list row: the read time, "Recorded" for the vault trade, nothing while unread. */
export function metaOf(row: OrderRow): string {
  if (row.read.state === "signed") {
    const t = timeOf(row);
    return t === null ? "" : whenShort(new Date(t).toISOString());
  }
  if (row.kind === "vault") return "Recorded";
  const live = liveOf(row);
  return timeOf(row) !== null && live?.updatedAt ? whenShort(live.updatedAt) : "";
}

/** A hash, shortened for a pill: the first eight and the last four characters. */
export function shortHash(h: string, head = 8, tail = 4): string {
  return h.length > head + tail + 1 ? `${h.slice(0, head)}…${h.slice(-tail)}` : h;
}

/** Hashes from a list that 1Click returns as strings or as { hash, explorerUrl }. Only https explorer links are kept. */
export function refsOf(list: unknown): HashRef[] {
  if (!Array.isArray(list)) return [];
  const out: HashRef[] = [];
  for (const x of list) {
    if (typeof x === "string" && x) out.push({ hash: x, explorerUrl: null });
    else if (x && typeof x === "object") {
      const { hash, explorerUrl } = x as { hash?: unknown; explorerUrl?: unknown };
      if (typeof hash === "string" && hash) {
        out.push({ hash, explorerUrl: typeof explorerUrl === "string" && /^https:\/\//.test(explorerUrl) ? explorerUrl : null });
      }
    }
  }
  return out;
}

/** The public explorer for a transaction on a chain, or null when the chain is not one the page links. */
export function explorerFor(chain: string | undefined, hash: string): string | null {
  switch (chain) {
    case "near": return tx(hash);
    case "sol": return /^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(hash) ? `https://solscan.io/tx/${hash}` : null;
    case "base": return /^0x[0-9a-fA-F]{64}$/.test(hash) ? `https://basescan.org/tx/${hash}` : null;
    case "arb": return /^0x[0-9a-fA-F]{64}$/.test(hash) ? `https://arbiscan.io/tx/${hash}` : null;
    default: return null;
  }
}

/* ---------- Filters, date range, search, pages ---------- */

export type FilterId = "all" | "settled" | "refunded" | "failed";
export const RANGES = [
  { id: "all", label: "All time", ms: null },
  { id: "1d", label: "Last 24 hours", ms: 24 * 3600_000 },
  { id: "7d", label: "Last 7 days", ms: 7 * 24 * 3600_000 },
  { id: "30d", label: "Last 30 days", ms: 30 * 24 * 3600_000 },
] as const;
export type RangeId = (typeof RANGES)[number]["id"];

/** Whether a row is inside a date range. An order with no readable time is outside every bounded range. */
export function inRange(row: OrderRow, range: RangeId, now: number): boolean {
  const ms = RANGES.find((r) => r.id === range)?.ms ?? null;
  if (ms === null) return true;
  const t = timeOf(row);
  return t !== null && now - t <= ms;
}

export type Query = { filter: FilterId; range: RangeId; text: string; now: number };

/** The rows that pass the status filter, the date range and the search, in the page's order. */
export function filterOrders(rows: readonly OrderRow[], q: Query): OrderRow[] {
  const needle = q.text.trim().toLowerCase();
  return rows.filter((r) =>
    (q.filter === "all" || bucketOf(r) === q.filter) &&
    inRange(r, q.range, q.now) &&
    (!needle || searchTextOf(r).includes(needle)),
  );
}

/** Everything a search can match: the labels, the hashes, the amounts and the 1Click words. */
export function searchTextOf(row: OrderRow): string {
  if (row.read.state === "signed") {
    const e = row.read.entry;
    const parts = [row.title, chipOf(row).label, e.kind, e.token_in, e.token_out, e.token, e.chain, e.status, e.amount_in, e.amount_out, e.amount, subOf(row), row.read.callId];
    return parts.filter((p) => p !== null && p !== undefined && String(p) !== "").map(String).join(" ").toLowerCase();
  }
  const s = row.settlement;
  const live = liveOf(row);
  const d = live?.details;
  const parts: (string | null | undefined)[] = [
    row.title, row.id, chipOf(row).label, subOf(row), s?.quote, s?.depositTx, s?.destTx?.hash,
    assetParts(row.from)?.symbol, assetParts(row.from)?.chainName, assetParts(row.to)?.symbol, assetParts(row.to)?.chainName,
  ];
  if (d) {
    parts.push(d.depositedAmountFormatted, d.amountOutFormatted, d.refundedAmountFormatted);
    for (const list of [d.intentHashes, d.nearTxHashes, d.destinationChainTxHashes]) parts.push(...refsOf(list).map((r) => r.hash));
  }
  if (row.kind === "vault") parts.push(VAULT_TRADE.amountIn, VAULT_TRADE.amountOut, VAULT_TRADE.intentHash, VAULT_TRADE.account);
  return parts.filter((p): p is string => typeof p === "string" && p !== "").join(" ").toLowerCase();
}

export const PAGE_SIZE = 5;

/** One page of a list. The page number is clamped to the real range, so an empty list has one empty page. */
export function pageSlice<T>(items: readonly T[], page: number, size = PAGE_SIZE): { items: T[]; page: number; pages: number; total: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { items: items.slice((p - 1) * size, p * size), page: p, pages, total: items.length };
}

/** The page buttons to show: every page up to seven, otherwise the first, the last and the ones next to the current page. */
export function pageNumbers(page: number, pages: number): (number | "gap")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = [...new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages))].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  keep.forEach((n, i) => {
    if (i > 0 && n - keep[i - 1] > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

/* ---------- Order details: summary, timeline, proof, raw data ---------- */

/** The From, To, Received and last-update lines of the details panel. */
export function summaryOf(row: OrderRow): {
  from: { symbol: string; chainName: string; chainId: string; assetId: string; amount: string | null } | null;
  to: { symbol: string; chainName: string; chainId: string; assetId: string } | null;
  received: string;
  updatedLabel: string;
  updated: string;
} {
  const from = assetParts(row.from);
  const to = assetParts(row.to);
  if (row.read.state === "signed") {
    const e = row.read.entry;
    const t = timeOf(row);
    return {
      from: null, to: null,
      received: e.amount_out != null && e.amount_out !== "" ? amountText(e.amount_out, e.token_out) : "Not recorded in the entry",
      updatedLabel: "Time",
      updated: t === null ? "Time not recorded" : whenLong(new Date(t).toISOString()),
    };
  }
  if (row.kind === "vault") {
    return {
      from: from && { ...from, amount: VAULT_TRADE.amountIn.split(" ")[0] ?? null },
      to,
      received: VAULT_TRADE.amountOut,
      updatedLabel: "Time",
      updated: "Not part of this public example record",
    };
  }
  const live = liveOf(row);
  const d = live?.details;
  const b = bucketOf(row);
  const refunded = nz(d?.refundedAmountFormatted);
  let received: string;
  if (row.read.state === "loading") received = "Reading the live status";
  else if (row.read.state === "error") received = "Not read";
  else if (!live) received = "Not recognised";
  else if (b === "settled") received = d?.amountOutFormatted ? [d.amountOutFormatted, to?.symbol].filter(Boolean).join(" ") : "Not reported by 1Click";
  else if (b === "refunded" || b === "failed") received = refunded ? ["None. " + refunded, from?.symbol, "was refunded."].filter(Boolean).join(" ") : "None. The deposit was refunded.";
  else received = "Not yet";
  const t = timeOf(row);
  const updated = t !== null ? whenLong(new Date(t).toISOString()) : row.read.state === "loading" ? "Reading" : row.read.state === "error" ? "Not read" : "Not reported by 1Click";
  return {
    from: from && { ...from, amount: nz(d?.depositedAmountFormatted) ?? null },
    to,
    received,
    updatedLabel: "Last update",
    updated,
  };
}

/** "Where the funds are": the 1Click explanation for the status, or the honest state while it is not read. */
export function whereOf(row: OrderRow): string {
  if (row.read.state === "signed") return "Recorded in your key's signed history. Verify the call to see its attestation.";
  if (row.kind === "vault") return "Settled inside the key's vault. Intel TDX attested the answer.";
  if (row.status) return statusOf(row.status).where;
  if (row.read.state === "loading") return "Reading the live status from 1Click.";
  if (row.read.state === "error") return "The live status could not be read. Try again.";
  return "1Click returned a status this page does not recognise.";
}

export type StepState = "done" | "current" | "todo" | "skipped";
export type TimelineLink = { label: string; hash: string; href: string | null };
export type TimelineStep = {
  id: "deposit" | "intent" | "final";
  title: string;
  sub: string;
  state: StepState;
  amount: string | null;
  links: TimelineLink[];
};
/** `step` is the funds step (lib/oneclick fundsStep, 0 to 3), or -1 while the status is not read. */
export type Timeline = { step: number; refund: boolean; steps: TimelineStep[] };

/**
 * The three steps of one order, driven by the real status and the real hashes. A step is "done" only when the status says so;
 * "skipped" means the order never reached it (no intent hash came back). The vault trade is settled by its recorded evidence.
 */
export function timelineOf(row: OrderRow): Timeline {
  // A history entry has no 1Click route; its details panel shows the entry instead (see OrderDetails).
  if (row.read.state === "signed") return { step: -1, refund: false, steps: [] };
  if (row.kind === "vault") {
    return {
      step: 3, refund: false,
      steps: [
        {
          id: "deposit", title: "Signed and checked in the enclave",
          sub: "The holder signed one swap. The enclave checked the signature, the holder and the caps.",
          state: "done", amount: VAULT_TRADE.amountIn, links: [],
        },
        {
          id: "intent", title: "Intent matched", sub: "Route sent through NEAR Intents.", state: "done", amount: null,
          links: [{ label: "intent", hash: VAULT_TRADE.intentHash, href: intentTx(VAULT_TRADE.intentHash) }],
        },
        {
          id: "final", title: "Settled", sub: "Received in the key's sealed account.", state: "done", amount: VAULT_TRADE.amountOut, links: [],
        },
      ],
    };
  }
  const f = row.status ? fundsStep(row.status) : null;
  const live = liveOf(row);
  const d = live?.details;
  const s = row.settlement;
  const intents = refsOf(d?.intentHashes);

  const deposit: TimelineStep = {
    id: "deposit", title: "Deposit", sub: "Funds sent to the 1Click deposit address.",
    state: !f ? "todo" : f.step >= 1 ? "done" : "current",
    amount: nz(d?.depositedAmountFormatted) ? `${d?.depositedAmountFormatted} ${assetParts(row.from)?.symbol ?? ""}`.trim() : null,
    links: s ? [{ label: "deposit tx", hash: s.depositTx, href: s.depositTxUrl ?? explorerFor(row.from?.chain, s.depositTx) }] : [],
  };

  const intentState: StepState = !f ? "todo" : f.step === 2 ? "current" : f.step >= 3 ? (intents.length ? "done" : "skipped") : "todo";
  const intent: TimelineStep = {
    id: "intent", title: "Intent matched",
    sub: intentState === "skipped" ? "No intent hash came back for this order."
      : intentState === "current" ? "Solvers are filling the route inside NEAR Intents."
      : intentState === "todo" ? "Starts once the deposit is seen."
      : "Route sent through NEAR Intents.",
    state: intentState, amount: null,
    links: intents.map((h) => ({ label: "intent", hash: h.hash, href: intentTx(h.hash) })),
  };

  let final: TimelineStep;
  if (f && f.step === 3 && !f.refund) {
    const dest = destinationLink(live, row);
    final = {
      id: "final", title: "Settled", sub: "Funds arrived at the recipient.", state: "done",
      amount: nz(d?.amountOutFormatted) ? `${d?.amountOutFormatted} ${assetParts(row.to)?.symbol ?? ""}`.trim() : null,
      links: dest ? [dest] : [],
    };
  } else if (f && f.refund) {
    final = {
      id: "final", title: row.status === "FAILED" ? "Failed, refunded to sender" : "Refunded to sender",
      sub: "The deposit went back to the refund address.", state: "done",
      amount: nz(d?.refundedAmountFormatted) ? `${d?.refundedAmountFormatted} ${assetParts(row.from)?.symbol ?? ""}`.trim() : null,
      links: [],
    };
  } else {
    final = { id: "final", title: "Settled", sub: "Funds arrive here once the route settles.", state: "todo", amount: null, links: [] };
  }
  return { step: f ? f.step : -1, refund: f ? f.refund : false, steps: [deposit, intent, final] };
}

/** The settlement transaction: the destination chain hash first (its own explorer link when 1Click gives one), then the record. */
function destinationLink(live: LiveStatus | null, row: OrderRow): TimelineLink | null {
  const dest = refsOf(live?.details.destinationChainTxHashes)[0];
  if (dest) return { label: "settlement tx", hash: dest.hash, href: dest.explorerUrl ?? explorerFor(row.to?.chain, dest.hash) };
  if (row.settlement?.destTx) return { label: "settlement tx", hash: row.settlement.destTx.hash, href: row.settlement.destTx.url };
  const near = refsOf(live?.details.nearTxHashes).at(-1);
  if (near) return { label: "settlement tx", hash: near.hash, href: tx(near.hash) };
  return null;
}

export type ProofItem = { label: string; value: string; href?: string; alt?: string; internal?: boolean };

/** Every hash and id of an order, with its explorer. Duplicates are dropped (the list keys on label and value). */
export function proofRowsOf(row: OrderRow): ProofItem[] {
  if (row.read.state === "signed") return [{ label: "enclave call", value: row.read.callId, href: `/verify?call=${row.read.callId}`, internal: true }];
  if (row.kind === "vault") {
    return [
      { label: "enclave call", value: VAULT_TRADE.callId, href: `/verify?call=${VAULT_TRADE.callId}`, internal: true },
      { label: "intent hash", value: VAULT_TRADE.intentHash, href: intentTx(VAULT_TRADE.intentHash) },
      { label: "account", value: VAULT_TRADE.account },
      { label: "evidence file", value: VAULT_TRADE.file },
    ];
  }
  const out: ProofItem[] = [];
  const s = row.settlement;
  const d = liveOf(row)?.details;
  if (s) {
    const href = s.depositTxUrl ?? explorerFor(row.from?.chain, s.depositTx);
    out.push({ label: "deposit tx", value: s.depositTx, href: href ?? undefined, alt: !s.depositTxUrl && row.from?.chain === "near" ? txAlt(s.depositTx) : undefined });
  }
  out.push({ label: "deposit address", value: row.id });
  for (const h of refsOf(d?.intentHashes)) out.push({ label: "intent", value: h.hash, href: intentTx(h.hash) });
  for (const h of refsOf(d?.nearTxHashes)) out.push({ label: "near tx", value: h.hash, href: tx(h.hash), alt: txAlt(h.hash) });
  for (const h of refsOf(d?.originChainTxHashes)) out.push({ label: "origin tx", value: h.hash, href: h.explorerUrl ?? explorerFor(row.from?.chain, h.hash) ?? undefined });
  for (const h of refsOf(d?.destinationChainTxHashes)) out.push({ label: "destination tx", value: h.hash, href: h.explorerUrl ?? explorerFor(row.to?.chain, h.hash) ?? undefined });
  if (s?.destTx) out.push({ label: "destination tx", value: s.destTx.hash, href: s.destTx.url });
  const seen = new Set<string>();
  return out.filter((r) => {
    const k = `${r.label}|${r.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The "View proof" target: the internal enclave call for the vault trade; otherwise the first intent, then any hash link. */
export function proofHrefOf(row: OrderRow): { href: string; internal: boolean } | null {
  if (row.read.state === "signed") return { href: `/verify?call=${row.read.callId}`, internal: true };
  if (row.kind === "vault") return { href: `/verify?call=${VAULT_TRADE.callId}`, internal: true };
  const items = proofRowsOf(row);
  const pick = items.find((r) => r.label === "intent" && r.href) ?? items.find((r) => r.href);
  return pick?.href ? { href: pick.href, internal: false } : null;
}

/** The explorer behind the header's external-link icon: the intent when there is one, otherwise the first hash link. */
export function explorerHrefOf(row: OrderRow): string | null {
  if (row.read.state === "signed") return null;
  if (row.kind === "vault") return intentTx(VAULT_TRADE.intentHash);
  const p = proofHrefOf(row);
  return p && !p.internal ? p.href : null;
}

/** The raw JSON the "Raw data" button shows: the status read exactly as the page received it, or the recorded vault record. */
export function rawJsonOf(row: OrderRow): string {
  if (row.read.state === "signed") return JSON.stringify({ callId: row.read.callId, entry: row.read.entry }, null, 2);
  if (row.kind === "vault") return JSON.stringify(VAULT_TRADE, null, 2);
  if (row.read.state === "ok") return JSON.stringify({ depositAddress: row.id, ...row.read.live }, null, 2);
  return JSON.stringify({ depositAddress: row.id, status: null, read: row.read.state }, null, 2);
}

/* ---------- The holder's own trades: the signed history of this key ---------- */

/** The entry kinds the page merges into "Your vault": swaps, copy trades, withdrawals and deposits. Other kinds are not merged. */
export const HISTORY_KINDS = ["swap", "copy", "withdraw", "deposit"] as const;

/** The worker's status words for a history entry, with the bucket each one counts in. Any other word is "Not recognised". */
const MINE_WORD: Record<string, { bucket: Bucket; label: string }> = {
  success: { bucket: "settled", label: "Settled" },
  completed: { bucket: "settled", label: "Completed" },
  refunded: { bucket: "refunded", label: "Refunded" },
  failed: { bucket: "failed", label: "Failed" },
  pending: { bucket: "open", label: "Pending" },
  expired: { bucket: "open", label: "Expired" },
};
export function mineWordOf(entry: HistEntry): { bucket: Bucket; label: string } | null {
  const w = typeof entry.status === "string" ? entry.status.toLowerCase() : "";
  return w && Object.hasOwn(MINE_WORD, w) ? MINE_WORD[w] : null;
}

const TONE_BY_BUCKET: Record<Bucket, ChipTone> = { settled: "success", refunded: "warn", failed: "error", open: "info", unread: "neutral" };

/**
 * The rows of the holder's own trades, newest first. Only entries of HISTORY_KINDS are merged. Each row keeps its entry and the
 * attested call it came from. Call this only once the call's log has verified (see mineStateOf): an unverified log is never listed.
 */
export function historyRows(entries: readonly HistEntry[] | null | undefined, callId: string | null | undefined): OrderRow[] {
  if (!entries || !callId) return [];
  return entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => (HISTORY_KINDS as readonly string[]).includes(entry.kind ?? ""))
    .sort((a, b) => (b.entry.ts_ms ?? 0) - (a.entry.ts_ms ?? 0) || b.index - a.index)
    .map(({ entry, index }): OrderRow => ({
      id: `${callId}:${index}`,
      kind: "mine",
      title: kindLabel(entry.kind),
      settlement: null,
      read: { state: "signed", entry, callId },
      status: null,
      from: null,
      to: null,
    }));
}

/**
 * Where the "Your vault" source stands. Pure: the caller reads the session, the key, the signed history and the log check.
 * Only "ready" lists entries; every other state says what is missing, and nothing is counted.
 */
export type MineState = "signed-out" | "keys-loading" | "no-key" | "locked" | "reading" | "error" | "checking" | "unverified" | "ready";
export function mineStateOf(i: {
  signedIn: boolean; keysReady: boolean; hasKey: boolean; live: boolean; busy: boolean; read: boolean; failed: boolean; logOk: boolean | null;
}): MineState {
  if (!i.signedIn) return "signed-out";
  if (!i.keysReady) return "keys-loading";
  if (!i.hasKey) return "no-key";
  if (!i.live) return "locked";
  if (i.busy) return "reading";
  if (i.failed) return "error";
  if (!i.read) return "reading";
  if (i.logOk === null) return "checking";
  if (i.logOk === false) return "unverified";
  return "ready";
}

/** The source shown until the reader picks one: "Your vault" when the verified history has entries, otherwise the public orders. */
export function defaultSourceOf(mineCount: number): "mine" | "public" {
  return mineCount > 0 ? "mine" : "public";
}
