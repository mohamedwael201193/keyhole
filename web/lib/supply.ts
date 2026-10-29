import { KEYS_CONTRACT, RPC_URL } from "./config";

/** Official mainnet first, then a public fallback. The intents explorer URL is not involved. */
const SUPPLY_RPCS = [RPC_URL, "https://free.rpc.fastnear.com"];
const TTL = 60_000;
let cache: { at: number; n: number } | null = null;
let inflight: Promise<number | null> | null = null;

async function querySupply(url: string): Promise<number> {
  const args_base64 = Buffer.from("{}").toString("base64");
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({
      jsonrpc: "2.0", id: "kh", method: "query",
      params: { request_type: "call_function", finality: "final", account_id: KEYS_CONTRACT, method_name: "nft_total_supply", args_base64 },
    }),
  });
  const j = await r.json();
  if (!r.ok || j.error || j.result?.error) throw new Error("rpc");
  const raw = JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error("supply");
  return n;
}

/** Keys minted, for the hero. A hit is reused for a minute; a miss tries the next RPC. */
export async function readSupply(): Promise<number | null> {
  if (cache && Date.now() - cache.at < TTL) return cache.n;
  if (inflight) return inflight;
  inflight = (async () => {
    for (const url of SUPPLY_RPCS) {
      try {
        const n = await querySupply(url);
        cache = { at: Date.now(), n };
        return n;
      } catch { /* try the other endpoint */ }
    }
    return cache?.n ?? null;
  })().finally(() => { inflight = null; });
  return inflight;
}
