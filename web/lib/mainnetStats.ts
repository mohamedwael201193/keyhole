import { KEYS_CONTRACT } from "./config";

/** Repo RPC first, then the public fallback, then the official mainnet endpoint. */
export const STATS_RPCS = ["https://rpc.mainnet.fastnear.com", "https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"] as const;
export const STATS_TTL_MS = 20_000;
const INDEXERS = ["https://api.nearblocks.io", "https://api3.nearblocks.io"] as const;
const KEY_METHODS = new Set(["nft_mint", "nft_transfer", "nft_set_tier", "beat", "nft_list", "nft_buy"]);
const MAX_KEYS = 400;

export type Live<T> = { ok: true; value: T } | { ok: false; value: null };
export type KeyEvent = { hash: string; method: string; at: string | null };
export type MainnetStats = {
  live: boolean;
  contract: string;
  network: "mainnet";
  fetchedAt: string | null;
  totalKeys: Live<number>;
  holders: Live<number>;
  activeLiens: Live<number>;
  latestEvent: Live<KeyEvent>;
};

const miss = <T>(): Live<T> => ({ ok: false, value: null });
const hit = <T>(value: T): Live<T> => ({ ok: true, value });

export function unavailableStats(contract = KEYS_CONTRACT): MainnetStats {
  return {
    live: false, contract, network: "mainnet", fetchedAt: null,
    totalKeys: miss(), holders: miss(), activeLiens: miss(), latestEvent: miss(),
  };
}

type TokenRow = { token_id?: string; owner_id?: string };
type LoanRow = { state?: string } | null;

export function distinctHolders(tokens: TokenRow[]): number | null {
  const ids = tokens.map((t) => t.owner_id).filter((id): id is string => typeof id === "string" && id.length > 0);
  if (ids.length !== tokens.length) return null;
  return new Set(ids).size;
}

/** A loan row exists only while the lien is open. Closed loans are removed from the contract. */
export function countOpenLoans(loans: (LoanRow | undefined)[]): number | null {
  if (loans.some((l) => l === undefined)) return null;
  return loans.filter((l) => l != null).length;
}

export type IndexerTxn = {
  transaction_hash?: string;
  block_timestamp?: string | number;
  receiver_account_id?: string;
  outcomes?: { status?: boolean };
  actions?: { method?: string | null; action?: string | null }[];
};

/** Newest successful key-method receipt. A failed or unrelated row is not an event. */
export function newestKeyEvent(rows: IndexerTxn[], contract = KEYS_CONTRACT): KeyEvent | null {
  let best: { at: bigint; event: KeyEvent } | null = null;
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.outcomes?.status !== true) continue;
    if (row.receiver_account_id !== contract) continue;
    const hash = row.transaction_hash;
    const method = row.actions?.find((a) => typeof a.method === "string" && KEY_METHODS.has(a.method))?.method;
    if (!hash || !method || seen.has(hash) || !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash)) continue;
    seen.add(hash);
    const raw = row.block_timestamp;
    const ns = typeof raw === "number" ? BigInt(Math.trunc(raw)) : typeof raw === "string" && /^\d+$/.test(raw) ? BigInt(raw) : null;
    const at = ns == null ? null : new Date(Number(ns / 1_000_000n)).toISOString();
    const stamp = ns ?? -1n;
    if (!best || stamp > best.at) best = { at: stamp, event: { hash, method, at } };
  }
  return best?.event ?? null;
}

async function rpcCall(url: string, method: string, args: Record<string, unknown>, timeoutMs: number, fetchImpl: typeof fetch): Promise<unknown> {
  const r = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
    body: JSON.stringify({
      jsonrpc: "2.0", id: "stats", method: "query",
      params: {
        request_type: "call_function", finality: "final", account_id: KEYS_CONTRACT, method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
  });
  const j = await r.json() as { error?: unknown; result?: { error?: unknown; result?: number[] } };
  if (!r.ok || j.error || j.result?.error || !j.result?.result) throw new Error("rpc");
  return JSON.parse(Buffer.from(j.result.result).toString("utf8"));
}

async function view(method: string, args: Record<string, unknown>, timeoutMs: number, fetchImpl: typeof fetch, rpcs: readonly string[]): Promise<unknown> {
  let last: unknown;
  for (const url of rpcs) {
    try { return await rpcCall(url, method, args, timeoutMs, fetchImpl); }
    catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error("rpc");
}

async function readEvent(timeoutMs: number, fetchImpl: typeof fetch): Promise<KeyEvent | null> {
  let last: unknown;
  for (const host of INDEXERS) {
    try {
      const rows: IndexerTxn[] = [];
      let cursor = "";
      for (let page = 0; page < 4; page++) {
        const q = new URL(`${host}/v3/accounts/${KEYS_CONTRACT}/txns`);
        q.searchParams.set("limit", "25");
        if (cursor) q.searchParams.set("next", cursor);
        const r = await fetchImpl(q.toString(), { signal: AbortSignal.timeout(timeoutMs), cache: "no-store", headers: { accept: "application/json" } });
        if (!r.ok) throw new Error("indexer");
        const j = await r.json() as { data?: IndexerTxn[]; meta?: { next_page?: string } };
        if (!Array.isArray(j.data)) throw new Error("indexer");
        rows.push(...j.data);
        if (newestKeyEvent(rows)) return newestKeyEvent(rows);
        cursor = j.meta?.next_page ?? "";
        if (!cursor) break;
      }
      return newestKeyEvent(rows);
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error("indexer");
}

export async function fetchMainnetStats(opt: { fetchImpl?: typeof fetch; timeoutMs?: number; rpcs?: readonly string[] } = {}): Promise<MainnetStats> {
  const fetchImpl = opt.fetchImpl ?? fetch;
  const timeoutMs = opt.timeoutMs ?? 4_000;
  const rpcs = opt.rpcs ?? STATS_RPCS;
  const base = unavailableStats();
  let supply: number;
  try {
    const raw = await view("nft_total_supply", {}, timeoutMs, fetchImpl, rpcs);
    supply = Number(raw);
    if (!Number.isInteger(supply) || supply < 0) return base;
  } catch { return base; }
  base.live = true;
  base.fetchedAt = new Date().toISOString();
  base.totalKeys = hit(supply);

  try {
    const tokens: TokenRow[] = [];
    let from = 0;
    while (tokens.length < supply && tokens.length < MAX_KEYS) {
      const page = await view("nft_tokens", { from_index: String(from), limit: 50 }, timeoutMs, fetchImpl, rpcs);
      if (!Array.isArray(page) || page.length === 0) break;
      tokens.push(...page as TokenRow[]);
      from += page.length;
      if (page.length < 50) break;
    }
    if (tokens.length !== supply || tokens.length > MAX_KEYS) {
      base.holders = miss();
      base.activeLiens = miss();
    } else {
      const holders = distinctHolders(tokens);
      base.holders = holders == null ? miss() : hit(holders);
      const loans = await Promise.all(tokens.map(async (t) => {
        if (!t.token_id) return undefined;
        try { return await view("get_loan", { token_id: t.token_id }, timeoutMs, fetchImpl, rpcs) as LoanRow; }
        catch { return undefined; }
      }));
      const open = countOpenLoans(loans);
      base.activeLiens = open == null ? miss() : hit(open);
    }
  } catch {
    base.holders = miss();
    base.activeLiens = miss();
  }

  try {
    const event = await readEvent(timeoutMs, fetchImpl);
    base.latestEvent = event ? hit(event) : miss();
  } catch { base.latestEvent = miss(); }
  return base;
}

type Cache = { at: number; value: MainnetStats };
const slots = new Map<string, Cache>();

/**
 * Successful reads are reused for STATS_TTL_MS. A failed refresh drops the slot.
 * An expired success is never returned, so a dead RPC cannot keep showing old numbers as live.
 */
export async function readMainnetStats(opt: { now?: number; fetchImpl?: typeof fetch; ttlMs?: number; cacheKey?: string } = {}): Promise<MainnetStats> {
  const now = opt.now ?? Date.now();
  const ttl = opt.ttlMs ?? STATS_TTL_MS;
  const key = opt.cacheKey ?? "mainnet";
  const hitCache = slots.get(key);
  if (hitCache && now - hitCache.at < ttl && hitCache.value.live) return hitCache.value;
  try {
    const value = await fetchMainnetStats({ fetchImpl: opt.fetchImpl });
    if (!value.live) { slots.delete(key); return value; }
    slots.set(key, { at: now, value });
    return value;
  } catch {
    slots.delete(key);
    return unavailableStats();
  }
}

export function clearStatsCache() { slots.clear(); }
