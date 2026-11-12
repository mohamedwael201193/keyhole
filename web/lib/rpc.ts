import { KEYS_CONTRACT, RPC_URL, PLEDGE_SANDBOX } from "./config";

/** Official mainnet, then a public fallback. Each attempt gives up quickly. */
export const NEAR_RPCS = PLEDGE_SANDBOX?[RPC_URL]:[RPC_URL, "https://free.rpc.fastnear.com"];
const TTL = 60_000;
const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

/** Holder lookups stay per request. A shared cache would leak one wallet's keys to the next. */
export function isHolderRead(method: string, args: Record<string, unknown>): boolean {
  return method === "nft_tokens_for_owner" || Object.prototype.hasOwnProperty.call(args, "account_id");
}

/** `shared` reuses a public read for 60 s (fetch cache and in-memory map); `timeoutMs` bounds each RPC attempt. `blockId` pins the read to one block instead of `finality: final`. */
export interface ViewOpts { shared?: boolean; timeoutMs?: number; blockId?: string; /** Ask the configured primary RPC only; never the public fallback. For reads that gate a "verified" claim. */ primaryOnly?: boolean }

export type ViewMeta<T> = { value: T; blockHash: string };

async function callOne<T>(url: string, method: string, args: Record<string, unknown>, contract: string, share: boolean, timeoutMs: number, blockId?: string): Promise<ViewMeta<T>> {
  const args_base64 = typeof btoa === "function" ? btoa(JSON.stringify(args)) : Buffer.from(JSON.stringify(args)).toString("base64");
  const pin = blockId ? { block_id: blockId } : { finality: "final" as const };
  const r = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    ...(share ? { next: { revalidate: 60 } } : { cache: "no-store" as const }),
    body: JSON.stringify({
      jsonrpc: "2.0", id: "kh", method: "query",
      params: { request_type: "call_function", ...pin, account_id: contract, method_name: method, args_base64 },
    }),
  });
  const j = await r.json();
  if (!r.ok || j.error || j.result?.error) throw new Error(j.error?.cause?.name || j.result?.error || "rpc");
  const blockHash = typeof j.result?.block_hash === "string" ? j.result.block_hash : "";
  if (!blockHash) throw new Error("rpc");
  const value = JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result))) as T;
  return { value, blockHash };
}

/** One contract view plus the block hash the node reported. The cache key includes `blockId`, so two blocks do not share a row. */
export async function nearViewMeta<T>(method: string, args: Record<string, unknown> = {}, contract = KEYS_CONTRACT, opts: ViewOpts = {}): Promise<ViewMeta<T>> {
  const share = opts.shared ?? !isHolderRead(method, args);
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const key = JSON.stringify([contract, method, args, opts.blockId ?? "", opts.primaryOnly ? 1 : 0]);
  if (share) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.value as ViewMeta<T>;
    const pending = inflight.get(key);
    if (pending) return pending as Promise<ViewMeta<T>>;
  }
  const run = (async () => {
    let last: unknown;
    if (opts.primaryOnly) {
      // Reads that gate a "verified" claim: the configured primary RPC only, never the public fallback.
      const value = await callOne<T>(RPC_URL, method, args, contract, share, timeoutMs, opts.blockId);
      if (share) cache.set(key, { at: Date.now(), value });
      return value;
    }
    for (const url of NEAR_RPCS) {
      try {
        const value = await callOne<T>(url, method, args, contract, share, timeoutMs, opts.blockId);
        if (share) cache.set(key, { at: Date.now(), value });
        return value;
      } catch (e) { last = e; }
    }
    throw last instanceof Error ? last : new Error("rpc");
  })();
  if (!share) return run;
  inflight.set(key, run);
  try { return await run; }
  finally { inflight.delete(key); }
}

/** Public contract reads are reused for a minute. Holder reads always hit the chain unless the caller passes `shared: true`. */
export async function nearView<T>(method: string, args: Record<string, unknown> = {}, contract = KEYS_CONTRACT, opts: ViewOpts = {}): Promise<T> {
  const meta = await nearViewMeta<T>(method, args, contract, opts);
  return meta.value;
}
