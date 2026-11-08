import { describe, expect, it, vi } from "vitest";
import { fetchTokenList, trimToken, trimTokens, TOKENS_URL } from "@/lib/tokenList";
import { dryAnyBody, dryBody } from "@/lib/oneclick";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const CHAINS = ["near", "eth", "sol", "base", "arb", "bsc", "op", "pol", "btc", "avax", "ton", "tron", "sui", "aptos", "gnosis", "stellar", "xrp", "starknet", "aleo", "cardano", "hyperliquid", "monad", "plasma", "megaeth", "tempo", "zcash", "doge", "ltc", "bch", "xlm", "atom", "cosmos", "osmosis", "injective", "celestia", "kaia", "linea", "scroll", "mantle", "blast"];

/** A raw 1Click entry, as the live endpoint returns it (extra fields included). */
function raw(i: number, over: Record<string, unknown> = {}) {
  return { assetId: `nep141:t${i}.omft.near`, decimals: 6, blockchain: CHAINS[i % CHAINS.length], symbol: `T${i}`, price: 1.25, priceUpdatedAt: "2026-11-08T00:00:00.000Z", contractAddress: null, coingeckoId: "x", ...over };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("trimToken", () => {
  it("keeps only the six fields the app uses", () => {
    const t = trimToken(raw(1));
    expect(Object.keys(t!).sort()).toEqual(["assetId", "blockchain", "contractAddress", "decimals", "price", "symbol"]);
    expect(t).toEqual({ assetId: "nep141:t1.omft.near", symbol: "T1", blockchain: "eth", decimals: 6, price: 1.25, contractAddress: null });
  });

  it("drops an entry with a missing or malformed field, and never repairs it", () => {
    expect(trimToken({ ...raw(2), assetId: undefined })).toBeNull();
    expect(trimToken({ ...raw(2), assetId: "nep141:has space" })).toBeNull();
    expect(trimToken({ ...raw(2), symbol: "" })).toBeNull();
    expect(trimToken({ ...raw(2), symbol: "X".repeat(40) })).toBeNull();
    expect(trimToken({ ...raw(2), blockchain: "a b" })).toBeNull();
    expect(trimToken({ ...raw(2), decimals: "6" })).toBeNull();
    expect(trimToken({ ...raw(2), decimals: 6.5 })).toBeNull();
    expect(trimToken({ ...raw(2), decimals: 40 })).toBeNull();
    expect(trimToken(null)).toBeNull();
    expect(trimToken("nep141:x")).toBeNull();
  });

  it("keeps a token with no usable price, with price null", () => {
    expect(trimToken({ ...raw(3), price: "1.2" })?.price).toBeNull();
    expect(trimToken({ ...raw(3), price: -1 })?.price).toBeNull();
    expect(trimToken({ ...raw(3), price: undefined })?.price).toBeNull();
    expect(trimToken({ ...raw(3), price: 0 })?.price).toBe(0);
  });

  it("lower-cases the chain and keeps a contract address when there is one", () => {
    const t = trimToken({ ...raw(4), blockchain: "ETH", contractAddress: "0xabc" });
    expect(t).toMatchObject({ blockchain: "eth", contractAddress: "0xabc" });
  });
});

describe("trimTokens", () => {
  it("keeps the usable entries in order and the first of any duplicate assetId", () => {
    const out = trimTokens([raw(1), raw(1, { symbol: "DUP" }), { bad: true }, raw(2)]);
    expect(out?.map((t) => t.symbol)).toEqual(["T1", "T2"]);
  });

  it("returns null for a body that is not an array", () => {
    expect(trimTokens({ tokens: [] })).toBeNull();
    expect(trimTokens(null)).toBeNull();
  });
});

describe("fetchTokenList", () => {
  it("reads the 1Click endpoint once and returns the trimmed 216-token list", async () => {
    const all = Array.from({ length: 216 }, (_, i) => raw(i));
    const f = vi.fn(async () => jsonResponse(all));
    const r = await fetchTokenList(f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String((f.mock.calls as unknown[][])[0]?.[0])).toBe(TOKENS_URL);
    expect(TOKENS_URL).toBe("https://1click.chaindefuser.com/v0/tokens");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tokens).toHaveLength(216);
      expect(new Set(r.tokens.map((t) => t.blockchain)).size).toBe(CHAINS.length);
    }
  });

  it("reports an upstream failure, a non-2xx status and a network error as upstream", async () => {
    expect(await fetchTokenList((async () => jsonResponse({ message: "down" }, 503)) as unknown as typeof fetch)).toEqual({ ok: false, error: "upstream" });
    expect(await fetchTokenList((async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch)).toEqual({ ok: false, error: "upstream" });
  });

  it("reports a body that is not JSON or not a list as bad_shape", async () => {
    expect(await fetchTokenList((async () => jsonResponse("<html>")) as unknown as typeof fetch)).toEqual({ ok: false, error: "bad_shape" });
    expect(await fetchTokenList((async () => jsonResponse({ tokens: [raw(1)] })) as unknown as typeof fetch)).toEqual({ ok: false, error: "bad_shape" });
  });

  it("reports a list with nothing usable as no_valid_tokens, never as an empty success", async () => {
    expect(await fetchTokenList((async () => jsonResponse([{ nope: 1 }])) as unknown as typeof fetch)).toEqual({ ok: false, error: "no_valid_tokens" });
    expect(await fetchTokenList((async () => jsonResponse([])) as unknown as typeof fetch)).toEqual({ ok: false, error: "no_valid_tokens" });
  });
});

describe("dryAnyBody (dry quotes for any listed asset)", () => {
  const now = Date.UTC(2026, 10, 8);
  it("builds a dry, intents-to-intents quote with a NEAR placeholder that receives nothing", () => {
    const b = dryAnyBody({ origin: "nep141:eth-0xabc.omft.near", dest: USDC, amount: "1000000" }, now)!;
    expect(b).toMatchObject({ dry: true, depositType: "INTENTS", refundType: "INTENTS", recipientType: "INTENTS", originAsset: "nep141:eth-0xabc.omft.near", destinationAsset: USDC, amount: "1000000" });
    expect(b.recipient).toBe("keyhole-devmo.near");
  });

  it("refuses the same asset on both sides, a bad charset, and an amount that is not base units", () => {
    expect(dryAnyBody({ origin: USDC, dest: USDC, amount: "1" })).toBeNull();
    expect(dryAnyBody({ origin: "nep141:x y", dest: USDC, amount: "1" })).toBeNull();
    expect(dryAnyBody({ origin: "nep141:a/../b", dest: USDC, amount: "1" })).toBeNull();
    expect(dryAnyBody({ origin: USDC, dest: "nep141:wrap.near", amount: "1e9" })).toBeNull();
    expect(dryAnyBody({ origin: USDC, dest: "nep141:wrap.near", amount: "-1" })).toBeNull();
  });

  it("leaves the fixed-pair builder unchanged", () => {
    expect(dryBody({ origin: "nep141:evil", dest: USDC, amount: "1" })).toBeNull();
  });
});
