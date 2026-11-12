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
  classifyTokenArg,
  type HistoryState,
  type IndexedEvent,
} from "./chainEvents";

const INTERESTING = new Set<string>([...TOKEN_METHODS, ...ACCOUNT_METHODS]);
const ACCOUNT = new Set<string>(ACCOUNT_METHODS);

const NEARBLOCKS = "https://api.nearblocks.io";
const ARCHIVAL = "https://archival-rpc.mainnet.near.org";

export type Hit = { tx: string; signer: string; atMs: number | null; account: boolean };

type FetchLike = typeof fetch;

function retryDelay(header: string | null): number {
  const seconds = Number(header ?? "");
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(2_000, seconds * 1_000);
  return 400;
}

/** One GET. A 429 waits for Retry-After and tries twice more. Other failures are unavailable. */
async function getJson(fetchImpl: FetchLike, url: string): Promise<{ ok: true; body: unknown } | { ok: false }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetchImpl(url, { signal: AbortSignal.timeout(8_000), headers: { accept: "application/json" }, cache: "no-store" });
      if (r.status === 429 && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(r.headers.get("retry-after"))));
        continue;
      }
      if (!r.ok) return { ok: false };
      return { ok: true, body: await r.json() };
    } catch {
      return { ok: false };
    }
  }
  return { ok: false };
}

function stamp(v: unknown): number | null {
  const s = typeof v === "string" || typeof v === "number" ? String(v) : "";
  return /^\d+$/.test(s) ? Number(BigInt(s) / 1_000_000n) : null;
}

/** One Nearblocks v3 receipt row. A missing hash or a non-array action list is not a usable receipt. */
export function receiptRowOk(item: unknown): boolean {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const row = item as { transaction_hash?: unknown; actions?: unknown; predecessor_account_id?: unknown; included_in_block_timestamp?: unknown };
  if (typeof row.transaction_hash !== "string" || row.transaction_hash.length === 0) return false;
  if (!Array.isArray(row.actions)) return false;
  if (row.actions.some((action) => !action || typeof action !== "object" || Array.isArray(action))) return false;
  if (row.predecessor_account_id != null && typeof row.predecessor_account_id !== "string") return false;
  if (row.included_in_block_timestamp != null && typeof row.included_in_block_timestamp !== "string" && typeof row.included_in_block_timestamp !== "number") return false;
  return true;
}

/** Nearblocks v3 receipt page: `{ data, meta.next_page }`. A 200 body without `data`, or a row that is not a receipt, is not an empty history. */
export function receiptPage(body: unknown): { txns: unknown[]; cursor: string | null } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const row = body as { data?: unknown; meta?: { next_page?: unknown } };
  if (!Object.prototype.hasOwnProperty.call(row, "data") || !Array.isArray(row.data)) return null;
  if (row.data.some((item) => !receiptRowOk(item))) return null;
  const next = row.meta?.next_page;
  if (next != null && typeof next !== "string") return null;
  return { txns: row.data, cursor: next ? next : null };
}

type IndexPage = { txns: unknown[]; complete: boolean; unavailable: boolean };
const indexCache = new Map<string, { at: number; value: IndexPage }>();
const INDEX_CACHE_MS = 60_000;

function methodOf(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const actions = (row as { actions?: { method?: unknown }[] }).actions ?? [];
  for (const action of actions) {
    if (typeof action?.method === "string" && INTERESTING.has(action.method)) return action.method;
  }
  const top = (row as { method?: unknown }).method;
  return typeof top === "string" && INTERESTING.has(top) ? top : null;
}

/** Receipt rows for one contract, with no method filter. Pages stop at `MAX_EVENT_PAGES`. */
async function paged(fetchImpl: FetchLike, urlFor: (cursor: string) => string): Promise<IndexPage> {
  const txns: unknown[] = [];
  let cursor = "";
  for (let i = 0; i < MAX_EVENT_PAGES; i++) {
    const res = await getJson(fetchImpl, urlFor(cursor));
    if (!res.ok) return { txns, complete: false, unavailable: true };
    const parsed = receiptPage(res.body);
    if (!parsed) return { txns, complete: false, unavailable: true };
    txns.push(...parsed.txns);
    const step = pageStep({ txns: parsed.txns, cursor: parsed.cursor }, i);
    if (step.stop) return { txns, complete: step.complete, unavailable: false };
    cursor = step.cursor ?? "";
  }
  return { txns, complete: false, unavailable: false };
}

/**
 * One receipt read for the contract, reused for about 60 seconds.
 * A failed receipt read falls back to one account transaction page, which carries the call arguments.
 * https://api.nearblocks.io/api-docs
 */
export async function pagesFor(
  fetchImpl: FetchLike,
  contractId: string,
  _method = "",
  nearblocks = NEARBLOCKS,
): Promise<IndexPage> {
  const key = `${nearblocks}|${contractId}`;
  const hit = indexCache.get(key);
  if (hit && Date.now() - hit.at < INDEX_CACHE_MS) return hit.value;
  let value = await paged(fetchImpl, (cursor) => {
    const q = new URL(`${nearblocks}/v3/accounts/${contractId}/receipts`);
    q.searchParams.set("limit", String(EVENT_PAGE_SIZE));
    if (cursor) q.searchParams.set("next", cursor);
    return q.toString();
  });
  if (value.unavailable && value.txns.length === 0) {
    const txs = await paged(fetchImpl, (cursor) => {
      const q = new URL(`${nearblocks}/v3/accounts/${contractId}/txns`);
      q.searchParams.set("limit", String(EVENT_PAGE_SIZE));
      if (cursor) q.searchParams.set("next", cursor);
      return q.toString();
    });
    value = {
      txns: txs.txns.map((row) => {
        if (!row || typeof row !== "object") return row;
        const tx = row as { block_timestamp?: unknown; included_in_block_timestamp?: unknown; signer_account_id?: unknown; predecessor_account_id?: unknown };
        return {
          ...tx,
          included_in_block_timestamp: tx.included_in_block_timestamp ?? tx.block_timestamp,
          predecessor_account_id: tx.predecessor_account_id ?? tx.signer_account_id,
        };
      }),
      complete: txs.complete,
      unavailable: txs.unavailable,
    };
  }
  if (!value.unavailable) indexCache.set(key, { at: Date.now(), value });
  return value;
}

const txnArgCache = new Map<string, unknown[]>();

export function resetKeyEventCache(): void {
  indexCache.clear();
  txnArgCache.clear();
  nftCache.clear();
  receiptHashCache.clear();
}
const TXN_CACHE_MAX = 200;
const TXN_LOOKUPS_PER_READ = 32;

function rememberTxnArgs(hash: string, args: unknown[]): void {
  if (txnArgCache.has(hash)) txnArgCache.delete(hash);
  txnArgCache.set(hash, args);
  while (txnArgCache.size > TXN_CACHE_MAX) {
    const oldest = txnArgCache.keys().next().value;
    if (oldest === undefined) break;
    txnArgCache.delete(oldest);
  }
}

/** v3 receipt rows omit args. The transaction object carries them under actions[].args. */
export async function attachTxnArgs(
  fetchImpl: FetchLike,
  txns: readonly unknown[],
  nearblocks = NEARBLOCKS,
): Promise<{ txns: unknown[]; unavailable: boolean }> {
  const out: unknown[] = [];
  let lookups = 0;
  let unavailable = false;
  for (const raw of txns) {
    if (!receiptRowOk(raw)) { out.push(raw); continue; }
    const row = raw as { transaction_hash: string; actions: { args?: unknown }[] };
    if (row.actions.every((action) => action.args != null)) { out.push(raw); continue; }
    const cached = txnArgCache.get(row.transaction_hash);
    let args = cached;
    if (!args) {
      if (lookups >= TXN_LOOKUPS_PER_READ) { unavailable = true; out.push(raw); continue; }
      lookups += 1;
      const res = await getJson(fetchImpl, `${nearblocks}/v3/txns/${row.transaction_hash}`);
      const actions = (res.ok ? (res.body as { data?: { actions?: unknown } })?.data?.actions : null);
      if (!Array.isArray(actions)) { unavailable = true; out.push(raw); continue; }
      args = actions.map((action) => (action && typeof action === "object" ? (action as { args?: unknown }).args : undefined));
      rememberTxnArgs(row.transaction_hash, args);
    }
    out.push({
      ...row,
      actions: row.actions.map((action, i) => (action.args != null ? action : { ...action, args: args?.[i] })),
    });
  }
  return { txns: out, unavailable };
}

export function hitsFrom(txns: readonly unknown[], tokenId: string, account: boolean): { hits: Hit[]; bad: boolean } {
  const hits: Hit[] = [];
  const seen = new Set<string>();
  let bad = false;
  for (const raw of txns) {
    if (!receiptRowOk(raw)) { bad = true; continue; }
    const t = raw as { transaction_hash: string; predecessor_account_id?: unknown; included_in_block_timestamp?: unknown; actions?: { args?: unknown }[] };
    const tx = t.transaction_hash;
    if (seen.has(tx)) continue;
    if (!account) {
      const actions = t.actions ?? [];
      if (!actions.length) { bad = true; continue; }
      let matched = false;
      for (const action of actions) {
        const kind = classifyTokenArg((action as { args?: unknown }).args, tokenId);
        if (kind === "unreadable") bad = true;
        if (kind === "match") matched = true;
      }
      if (!matched) continue;
    }
    seen.add(tx);
    hits.push({
      tx,
      signer: typeof t.predecessor_account_id === "string" ? t.predecessor_account_id : "",
      atMs: stamp(t.included_in_block_timestamp),
      account,
    });
  }
  return { hits, bad };
}

export async function signerOf(fetchImpl: FetchLike, hit: Hit, contractId: string, nearblocks = NEARBLOCKS): Promise<string | null> {
  if (hit.signer && hit.signer !== contractId) return hit.signer;
  const res = await getJson(fetchImpl, `${nearblocks}/v3/txns/${hit.tx}`);
  if (!res.ok) return null;
  const id = (res.body as { data?: { signer_account_id?: string } })?.data?.signer_account_id;
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

const nftCache = new Map<string, { at: number; events: IndexedEvent[] }>();
const receiptHashCache = new Map<string, string>();

/** One token's NFT movements. This is a single request, not one request per contract method. */
async function nftEvents(fetchImpl: FetchLike, contractId: string, tokenId: string, nearblocks: string): Promise<{ ok: boolean; events: IndexedEvent[] }> {
  const key = `${nearblocks}|${contractId}|${tokenId}`;
  const hit = nftCache.get(key);
  if (hit && Date.now() - hit.at < INDEX_CACHE_MS) return { ok: true, events: hit.events };
  const res = await getJson(fetchImpl, `${nearblocks}/v3/nfts/${contractId}/tokens/${encodeURIComponent(tokenId)}/txns?limit=${EVENT_PAGE_SIZE}`);
  if (!res.ok) return { ok: false, events: [] };
  const data = (res.body as { data?: { cause?: string; block_timestamp?: string; receipt_id?: string; affected_account_id?: string | null }[] }).data;
  if (!Array.isArray(data)) return { ok: false, events: [] };
  const events: IndexedEvent[] = [];
  for (const row of data) {
    const cause = (row.cause ?? "").toUpperCase();
    const event = cause === "MINT" ? "nft_mint" : cause === "TRANSFER" ? "nft_transfer" : cause === "BURN" ? "nft_burn" : "";
    if (!event) continue;
    let tx = row.receipt_id ? receiptHashCache.get(row.receipt_id) : undefined;
    if (!tx && row.receipt_id) {
      const found = await getJson(fetchImpl, `${nearblocks}/v3/search/receipts?keyword=${encodeURIComponent(row.receipt_id)}`);
      const hash = found.ok ? (found.body as { data?: { transaction_hash?: string }[] }).data?.[0]?.transaction_hash : "";
      if (hash) { tx = hash; receiptHashCache.set(row.receipt_id, hash); }
    }
    events.push({
      event, standard: "nep171", version: "1.0.0", tx: tx || row.receipt_id || "", atMs: stamp(row.block_timestamp),
      data: { token_id: tokenId, owner_id: row.affected_account_id ?? "" },
    });
  }
  nftCache.set(key, { at: Date.now(), events });
  return { ok: true, events };
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
  const nearblocks = opts.nearblocks ?? NEARBLOCKS;
  const nft = await nftEvents(fetchImpl, opts.contractId, opts.tokenId, nearblocks);
  if (nft.ok && nft.events.length > 0) return { events: nft.events, complete: true, unavailable: false };
  let complete = true;
  let unavailable = false;
  const hits: Hit[] = [];
  const seen = new Set<string>();
  const page = await pagesFor(fetchImpl, opts.contractId, "", opts.nearblocks);
  if (!page.complete) complete = false;
  if (page.unavailable) unavailable = true;
  const tokenRows: unknown[] = [];
  const accountRows: unknown[] = [];
  for (const row of page.txns) {
    const method = methodOf(row);
    if (!method) {
      const actions = (row as { actions?: { args?: unknown }[] }).actions ?? [];
      if (actions.some((action) => classifyTokenArg(action?.args, opts.tokenId) !== "unreadable")) tokenRows.push(row);
      continue;
    }
    if (ACCOUNT.has(method)) accountRows.push(row);
    else tokenRows.push(row);
  }
  const filled = await attachTxnArgs(fetchImpl, tokenRows, opts.nearblocks);
  if (filled.unavailable) { unavailable = true; complete = false; }
  for (const [rows, account] of [[filled.txns, false], [accountRows, true]] as const) {
    const found = hitsFrom(rows, opts.tokenId, account);
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
