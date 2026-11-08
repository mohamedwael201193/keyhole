import { describe, expect, it } from "vitest";
import { chainName, chainRank, fallbackTokens } from "@/lib/tokens";
import { formatAmount, formatTokenPrice } from "@/lib/amount";
import { chainChips, filterTokens, type TokenOption } from "@/components/ui/token-select";

const opt = (id: string, symbol: string, chain: string, extra: Partial<TokenOption> = {}): TokenOption => ({ id, symbol, name: chain, assetId: id, chain, chainName: chainName(chain), ...extra });

describe("chain names", () => {
  it("uses the display names the picker shows", () => {
    expect(chainName("near")).toBe("NEAR");
    expect(chainName("eth")).toBe("Ethereum");
    expect(chainName("sol")).toBe("Solana");
    expect(chainName("base")).toBe("Base");
    expect(chainName("arb")).toBe("Arbitrum");
    expect(chainName("bsc")).toBe("BNB Chain");
    expect(chainName("pol")).toBe("Polygon");
    expect(chainName("tron")).toBe("TRON");
    expect(chainName("ton")).toBe("TON");
  });

  it("title-cases a chain it does not know, and orders the main chains first", () => {
    expect(chainName("stellar")).toBe("Stellar");
    expect(chainName("xrp-ledger")).toBe("Xrp Ledger");
    expect(chainRank("near")).toBeLessThan(chainRank("eth"));
    expect(chainRank("eth")).toBeLessThan(chainRank("base"));
    expect(chainRank("stellar")).toBeGreaterThan(chainRank("gnosis"));
  });

  it("the fallback pair is the vault's two assets on NEAR", () => {
    const f = fallbackTokens();
    expect(f.map((t) => t.symbol)).toEqual(["USDC", "wNEAR"]);
    expect(f.map((t) => t.decimals)).toEqual([6, 24]);
    expect(f.every((t) => t.blockchain === "near")).toBe(true);
  });
});

describe("amounts never use exponent notation", () => {
  it("thousands separators and at most six decimals", () => {
    expect(formatAmount(1234567)).toBe("1,234,567");
    expect(formatAmount("1234567.891234567")).toBe("1,234,567.891235");
    expect(formatAmount(1.5)).toBe("1.5");
    expect(formatAmount("1.50000")).toBe("1.5");
    expect(formatAmount(0.25)).toBe("0.25");
  });

  it("a value that rounds to nothing reads as a bound, and a missing value as a dash", () => {
    expect(formatAmount(0.0000001)).toBe("<0.000001");
    expect(formatAmount(0)).toBe("0");
    expect(formatAmount(null)).toBe("—");
    expect(formatAmount("abc")).toBe("—");
  });

  it("very large and very small numbers stay in plain digits", () => {
    expect(formatAmount(1.23e21)).not.toMatch(/e/i);
    expect(formatAmount(1e-12)).not.toMatch(/e/i);
  });

  it("token prices: two decimals from a dollar, four significant digits below", () => {
    expect(formatTokenPrice(2.79)).toBe("$2.79");
    expect(formatTokenPrice(1234.5)).toBe("$1,234.50");
    expect(formatTokenPrice(0.0523)).toBe("$0.0523");
    expect(formatTokenPrice(0.000012345)).toMatch(/^\$0\.0000123/);
    expect(formatTokenPrice(0.000012345)).not.toMatch(/e/i);
    expect(formatTokenPrice(null)).toBe("—");
  });
});

describe("picker search and chain filter", () => {
  const list: TokenOption[] = [
    opt("nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "USDC", "near"),
    opt("nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", "USDC", "eth", { contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" }),
    opt("nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", "USDC", "sol"),
    opt("nep141:arb.omft.near", "ARB", "arb"),
  ];

  it("filters by chain id and by chain name", () => {
    expect(filterTokens(list, "", "eth").map((o) => o.chain)).toEqual(["eth"]);
    expect(filterTokens(list, "ethereum").map((o) => o.chain)).toEqual(["eth"]);
    expect(filterTokens(list, "solana").map((o) => o.chain)).toEqual(["sol"]);
  });

  it("finds a token by its contract address", () => {
    expect(filterTokens(list, "0xA0B86991C6218B36").map((o) => o.chain)).toEqual(["eth"]);
  });

  it("combines the search with the chain filter", () => {
    expect(filterTokens(list, "usdc", "sol")).toHaveLength(1);
    expect(filterTokens(list, "arb", "eth")).toHaveLength(0);
  });

  it("offers chain chips only when there is more than one chain, NEAR first", () => {
    expect(chainChips([opt("a", "USDC", "near")])).toEqual([]);
    expect(chainChips(list).map((c) => c.id)).toEqual(["near", "eth", "sol", "arb"]);
    expect(chainChips(list)[1]).toEqual({ id: "eth", label: "Ethereum" });
  });
});
