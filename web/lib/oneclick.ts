// 1Click (NEAR Intents) helpers shared by /api/oneclick and /settle. Dry-run only from the website.
export const OC_ASSETS = [
  { id: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", label: "USDC · NEAR", chain: "near", decimals: 6 },
  { id: "nep141:wrap.near", label: "wNEAR · NEAR", chain: "near", decimals: 24 },
  { id: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", label: "USDC · Solana", chain: "sol", decimals: 6 },
  { id: "nep141:sol.omft.near", label: "SOL · Solana", chain: "sol", decimals: 9 },
  { id: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", label: "USDC · Base", chain: "base", decimals: 6 },
  { id: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", label: "USDC · Arbitrum", chain: "arb", decimals: 6 },
] as const;
export type OcAsset = (typeof OC_ASSETS)[number];
/** Placeholder addresses for dry quotes only (nothing is ever sent to them). */
export const DRY_ADDR: Record<string, string> = { near: "keyhole-devmo.near", sol: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", base: "0x1111111111111111111111111111111111111111", arb: "0x1111111111111111111111111111111111111111" };

export const assetById = (id: string) => OC_ASSETS.find((a) => a.id === id);

/** Decimal string to base units, rejecting anything over $5-ish sized inputs for a dry demo (max 6 integer digits). */
export function toUnits(v: string, decimals: number): string | null {
  const m = v.trim().match(/^(\d{1,6})(?:\.(\d+))?$/);
  if (!m) return null;
  const s = (m[1] + (m[2] ?? "").slice(0, decimals).padEnd(decimals, "0")).replace(/^0+/, "");
  return s ? s : null;
}

export type DryReq = { origin: string; dest: string; amount: string };
export function dryBody(r: DryReq, now = Date.now()): Record<string, unknown> | null {
  const o = assetById(r.origin), d = assetById(r.dest);
  if (!o || !d || o.id === d.id || !/^\d{1,30}$/.test(r.amount)) return null;
  return {
    dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: o.id, depositType: "ORIGIN_CHAIN", destinationAsset: d.id,
    amount: r.amount, refundTo: DRY_ADDR[o.chain], refundType: "ORIGIN_CHAIN", recipient: DRY_ADDR[d.chain], recipientType: "DESTINATION_CHAIN",
    deadline: new Date(now + 30 * 60_000).toISOString(),
  };
}

export type OcStatus = "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";
export const STATUS: Record<OcStatus, { tone: "wait" | "ok" | "warn" | "bad"; label: string; where: string }> = {
  PENDING_DEPOSIT: { tone: "wait", label: "Waiting for deposit", where: "Funds are still in your wallet." },
  KNOWN_DEPOSIT_TX: { tone: "wait", label: "Deposit seen", where: "Funds are on their way to the 1Click deposit address." },
  INCOMPLETE_DEPOSIT: { tone: "warn", label: "Incomplete deposit", where: "Less than the quoted amount arrived. Funds sit at the deposit address and are refunded at the quote deadline unless topped up." },
  PROCESSING: { tone: "wait", label: "Processing", where: "Funds are inside NEAR Intents (intents.near) while solvers fill the swap." },
  SUCCESS: { tone: "ok", label: "Settled", where: "Funds arrived at the recipient." },
  REFUNDED: { tone: "warn", label: "Refunded", where: "The swap did not happen; the deposit went back to the refund address." },
  FAILED: { tone: "bad", label: "Failed", where: "The swap failed. 1Click refunds the deposit to the refund address; check the refund transaction before retrying." },
};
export const statusOf = (s: string | undefined | null) => (s && Object.hasOwn(STATUS, s) ? STATUS[s as OcStatus] : { tone: "wait" as const, label: s || "Unknown", where: "Status not recognised." });
export const isAddr = (s: string) => /^[0-9a-f]{64}$|^0x[0-9a-fA-F]{40}$|^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

/** Per-IP, per-minute limits on /api/oneclick. Status reads are read-only and /settle makes one per listed order, so they get their own, larger window; dry quotes keep the small one. */
export const QUOTE_PER_MIN = 10;
export const STATUS_PER_MIN = 60;
