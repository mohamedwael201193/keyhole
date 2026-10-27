export const ASSETS = {
  usdc: { id: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", symbol: "USDC", decimals: 6, logo: "usdc" },
  wnear: { id: "nep141:wrap.near", symbol: "wNEAR", decimals: 24, logo: "near" },
} as const;
export type AssetKey = keyof typeof ASSETS;
/** Decimal string → integer base units, no floating point. */
export function toBaseUnits(v: string, decimals: number): string | null {
  const m = v.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const frac = (m[2] || "").slice(0, decimals).padEnd(decimals, "0");
  const s = (m[1] + frac).replace(/^0+/, "");
  return s === "" ? null : s;
}
