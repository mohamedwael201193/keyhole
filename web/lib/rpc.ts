import { KEYS_CONTRACT, RPC_URL } from "./config";

/** Official mainnet, then a public fallback. Each attempt gives up quickly. */
export const NEAR_RPCS = [RPC_URL, "https://free.rpc.fastnear.com"];
const TTL = 60_000;
const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

/** Holder lookups stay per request. A shared cache would leak one wallet's keys to the next. */
export function isHolderRead(method: string, args: Record<string, unknown>): boolean {
  return method === "nft_tokens_for_owner" || Object.prototype.hasOwnProperty.call(args, "account_id");
}

async function callOne<T>(url: string, method: string, args: Record<string, unknown>, contract: string): Promise<T> {
  const args_base64 = typeof btoa === "function" ? btoa(JSON.stringify(args)) : Buffer.from(JSON.stringify(args)).toString("base64");
  const r = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
    signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({
      jsonrpc: "2.0", id: "kh", method: "query",
      params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64 },
    }),
  });
  const j = await r.json();
  if (!r.ok || j.error || j.result?.error) throw new Error(j.error?.cause?.name || j.result?.error || "rpc");
  return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result))) as T;
}

/** Public contract reads are reused for a minute. Holder reads always hit the chain. */
export async function nearView<T>(method: string, args: Record<string, unknown> = {}, contract = KEYS_CONTRACT): Promise<T> {
  const share = !isHolderRead(method, args);
  const key = JSON.stringify([contract, method, args]);
  if (share) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.value as T;
    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;
  }
  const run = (async () => {
    let last: unknown;
    for (const url of NEAR_RPCS) {
      try {
        const value = await callOne<T>(url, method, args, contract);
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
