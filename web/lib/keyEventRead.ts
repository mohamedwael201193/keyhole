/**
 * Bounded public read of sale and loan events.
 * Nearblocks supplies receipt pages. Archival `EXPERIMENTAL_tx_status` supplies finalized outcomes.
 * A failed fetch is unavailable, never an empty verified history.
 */
import {
  ACCOUNT_METHODS,
  EVENT_PAGE_SIZE,
  MAX_EVENT_PAGES,
  TOKEN_METHODS,
  authenticatedLogs,
  eventsForToken,
  pageStep,
  receiptToken,
  type HistoryState,
  type IndexedEvent,
} from "./chainEvents";

const NEARBLOCKS = "https://api.nearblocks.io";
const ARCHIVAL = "https://archival-rpc.mainnet.near.org";

export type Hit = { tx: string; signer: string; atMs: number | null; account: boolean };

type FetchLike = typeof fetch;

async function getJson(fetchImpl: FetchLike, url: string): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(8_000), headers: { accept: "application/json" }, cache: "no-store" });
    if (!r.ok) return { ok: false };
    return { ok: true, body: await r.json() };
  } catch {
    return { ok: false };
  }
}

function stamp(v: unknown): number | null {
  const s = typeof v === "string" || typeof v === "number" ? String(v) : "";
  return /^\d+$/.test(s) ? Number(BigInt(s) / 1_000_000n) : null;
}

/** One Nearblocks receipt row. A missing hash or a non-array action list is not a usable receipt. */
export function receiptRowOk(item: unknown): boolean {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const row = item as { transaction_hash?: unknown; actions?: unknown; predecessor_account_id?: unknown; block_timestamp?: unknown };
  if (typeof row.transaction_hash !== "string" || row.transaction_hash.length === 0) return false;
  if (!Array.isArray(row.actions)) return false;
  if (row.actions.some((action) => !action || typeof action !== "object" || Array.isArray(action))) return false;
  if (row.predecessor_account_id != null && typeof row.predecessor_account_id !== "string") return false;
  if (row.block_timestamp != null && typeof row.block_timestamp !== "string" && typeof row.block_timestamp !== "number") return false;
  return true;
}

/** Nearblocks receipt page. A 200 body without a `txns` array, or a row that is not a receipt, is not an empty history. */
export function receiptPage(body: unknown): { txns: unknown[]; cursor: string | null } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const row = body as { txns?: unknown; cursor?: unknown };
  if (!Object.prototype.hasOwnProperty.call(row, "txns") || !Array.isArray(row.txns)) return null;
  if (row.txns.some((item) => !receiptRowOk(item))) return null;
  if (row.cursor != null && typeof row.cursor !== "string") return null;
  return { txns: row.txns, cursor: row.cursor ? row.cursor : null };
}

/** One method's receipt pages, stopped at `MAX_EVENT_PAGES`. */
export async function pagesFor(
  fetchImpl: FetchLike,
  contractId: string,
  method: string,
  nearblocks = NEARBLOCKS,
): Promise<{ txns: unknown[]; complete: boolean; unavailable: boolean }> {
  const txns: unknown[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_EVENT_PAGES; i++) {
    const q = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const res = await getJson(fetchImpl, `${nearblocks}/v1/account/${contractId}/receipts?method=${method}&per_page=${EVENT_PAGE_SIZE}${q}`);
    if (!res.ok) return { txns, complete: false, unavailable: true };
    const parsed = receiptPage(res.body);
    if (!parsed) return { txns, complete: false, unavailable: true };
    const page = parsed.txns;
    const next = parsed.cursor;
    txns.push(...page);
    const step = pageStep({ txns: page, cursor: next }, i);
    if (step.stop) return { txns, complete: step.complete, unavailable: false };
    cursor = step.cursor;
  }
  return { txns, complete: false, unavailable: false };
}

export function hitsFrom(txns: readonly unknown[], tokenId: string, account: boolean): { hits: Hit[]; bad: boolean } {
  const hits: Hit[] = [];
  const seen = new Set<string>();
  let bad = false;
  for (const raw of txns) {
    if (!receiptRowOk(raw)) { bad = true; continue; }
    const t = raw as { transaction_hash: string; predecessor_account_id?: unknown; block_timestamp?: unknown; actions?: { args?: unknown }[] };
    const tx = t.transaction_hash;
    if (seen.has(tx)) continue;
    if (!account) {
      const args = (t.actions ?? []).map((a) => a?.args);
      if (!args.some((a) => receiptToken(a) === tokenId)) continue;
    }
    seen.add(tx);
    hits.push({
      tx,
      signer: typeof t.predecessor_account_id === "string" ? t.predecessor_account_id : "",
      atMs: stamp(t.block_timestamp),
      account,
    });
  }
  return { hits, bad };
}

export async function signerOf(fetchImpl: FetchLike, hit: Hit, contractId: string, nearblocks = NEARBLOCKS): Promise<string | null> {
  if (hit.signer && hit.signer !== contractId) return hit.signer;
  const res = await getJson(fetchImpl, `${nearblocks}/v1/txns/${hit.tx}`);
  if (!res.ok) return null;
  const id = (res.body as { txns?: { signer_account_id?: string }[] })?.txns?.[0]?.signer_account_id;
  return typeof id === "string" && id ? id : null;
}

export async function statusOf(fetchImpl: FetchLike, tx: string, signer: string, archival = ARCHIVAL): Promise<{ ok: true; result: unknown } | { ok: false }> {
  try {
    const r = await fetchImpl(archival, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
      body: JSON.stringify({ jsonrpc: "2.0", id: "kh-events", method: "EXPERIMENTAL_tx_status", params: [tx, signer] }),
    });
    if (!r.ok) return { ok: false };
    const j = await r.json() as { result?: unknown; error?: unknown };
    if (j.error || !j.result) return { ok: false };
    return { ok: true, result: j.result };
  } catch {
    return { ok: false };
  }
}

/** The public history for one token. Failures stay unavailable and are not rewritten as zero events. */
export async function readKeyHistory(opts: {
  tokenId: string;
  contractId: string;
  fetch?: FetchLike;
  nearblocks?: string;
  archival?: string;
}): Promise<HistoryState & { events: IndexedEvent[] }> {
  const fetchImpl = opts.fetch ?? fetch;
  let complete = true;
  let unavailable = false;
  const hits: Hit[] = [];
  const seen = new Set<string>();
  const methods = [
    ...TOKEN_METHODS.map((method) => ({ method, account: false })),
    ...ACCOUNT_METHODS.map((method) => ({ method, account: true })),
  ];
  for (const { method, account } of methods) {
    const page = await pagesFor(fetchImpl, opts.contractId, method, opts.nearblocks);
    if (!page.complete) complete = false;
    if (page.unavailable) unavailable = true;
    const found = hitsFrom(page.txns, opts.tokenId, account);
    if (found.bad) { unavailable = true; complete = false; }
    for (const hit of found.hits) {
      if (seen.has(hit.tx)) continue;
      seen.add(hit.tx);
      hits.push(hit);
    }
  }
  const rows: { tx: string; atMs: number | null; logs: string[] }[] = [];
  for (const hit of hits) {
    const signer = await signerOf(fetchImpl, hit, opts.contractId, opts.nearblocks);
    if (!signer) { unavailable = true; complete = false; continue; }
    const status = await statusOf(fetchImpl, hit.tx, signer, opts.archival);
    if (!status.ok) { unavailable = true; complete = false; continue; }
    const auth = authenticatedLogs(status.result, opts.contractId);
    if (!auth.final) { unavailable = true; complete = false; continue; }
    rows.push({ tx: hit.tx, atMs: hit.atMs, logs: auth.logs });
  }
  return { events: eventsForToken(rows, opts.tokenId), complete: complete && !unavailable, unavailable };
}
