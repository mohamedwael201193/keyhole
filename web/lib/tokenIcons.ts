/**
 * One map from asset ids, symbols and chain names to the self-hosted marks in public/tokens (sources: public/tokens/SOURCES.md).
 * Used by components/TokenIcon.tsx (and through it TokenPick and the asset rows). Unknown inputs return null, and the caller draws a monogram.
 */
export const TOKEN_ICON_FILES = {
  near: "/tokens/near.svg",
  usdc: "/tokens/usdc.svg",
  usdt: "/tokens/usdt.png",
  eth: "/tokens/eth.svg",
  sol: "/tokens/sol.svg",
  btc: "/tokens/btc.svg",
  base: "/tokens/base.svg",
  arb: "/tokens/arb.svg",
  zec: "/tokens/zec.svg",
} as const;
export type TokenIconKey = keyof typeof TOKEN_ICON_FILES;

/** NEP-141 contract ids on NEAR. wNEAR is wrap.near and uses the NEAR mark. */
const BY_ASSET_ID: Record<string, TokenIconKey> = {
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": "usdc",
  "nep141:usdt.tether-token.near": "usdt",
  "nep141:wrap.near": "near",
};

const BY_SYMBOL: Record<string, TokenIconKey> = {
  near: "near", wnear: "near",
  usdc: "usdc", usdt: "usdt",
  eth: "eth", sol: "sol", btc: "btc", base: "base",
  arb: "arb", arbitrum: "arb",
  zec: "zec", zcash: "zec",
};

const BY_CHAIN: Record<string, TokenIconKey> = {
  near: "near",
  ethereum: "eth", eth: "eth",
  solana: "sol", sol: "sol",
  bitcoin: "btc", btc: "btc",
  base: "base",
  arbitrum: "arb", arb: "arb",
  zcash: "zec", zec: "zec",
};

/** Icon for an asset id first, then the symbol, then the chain name. Null when none of them is mapped. */
export function tokenIcon(ref: { assetId?: string | null; symbol?: string | null; chain?: string | null }): { key: TokenIconKey; src: string } | null {
  const key =
    (ref.assetId && BY_ASSET_ID[ref.assetId.toLowerCase()]) ||
    (ref.symbol && BY_SYMBOL[ref.symbol.toLowerCase()]) ||
    (ref.chain && BY_CHAIN[ref.chain.toLowerCase()]) ||
    null;
  return key ? { key, src: TOKEN_ICON_FILES[key] } : null;
}

/** Two letters for a fallback mark, from the symbol: "wNEAR" becomes "WN", "" becomes "?". */
export function monogram(symbol: string | null | undefined): string {
  const letters = (symbol ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
  return letters || "?";
}
