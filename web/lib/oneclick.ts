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

/** Any 1Click asset id (the swap screen lists the whole token list). Charset only; 1Click decides whether it exists. */
const ANY_ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,139}$/;

/**
 * Dry quote for any listed asset. Both legs use intents deposits, so the only address is a NEAR placeholder that never
 * receives funds (a dry quote moves nothing). Used when the pair is not one of OC_ASSETS.
 */
export function dryAnyBody(r: DryReq, now = Date.now()): Record<string, unknown> | null {
  if (!ANY_ASSET_ID.test(r.origin) || !ANY_ASSET_ID.test(r.dest) || r.origin === r.dest || !/^\d{1,40}$/.test(r.amount)) return null;
  return {
    dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: r.origin, depositType: "INTENTS", destinationAsset: r.dest,
    amount: r.amount, refundTo: DRY_ADDR.near, refundType: "INTENTS", recipient: DRY_ADDR.near, recipientType: "INTENTS",
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

/** The four places funds can be during a 1Click order, in order. */
export const FUND_STEPS = ["Your wallet", "1Click deposit address", "NEAR Intents (intents.near)", "Recipient"] as const;
/** Which step the funds are at for a status, and whether the last step is the refund address instead of the recipient. */
export function fundsStep(status: string | null | undefined): { step: number; refund: boolean } | null {
  switch (status) {
    case "PENDING_DEPOSIT": return { step: 0, refund: false };
    case "KNOWN_DEPOSIT_TX": case "INCOMPLETE_DEPOSIT": return { step: 1, refund: false };
    case "PROCESSING": return { step: 2, refund: false };
    case "SUCCESS": return { step: 3, refund: false };
    case "REFUNDED": case "FAILED": return { step: 3, refund: true };
    default: return null;
  }
}

/**
 * Fund from any chain: an EXECUTABLE 1Click quote (docs: https://docs.near-intents.org/near-intents/integration/distribution-channels/1click-api)
 * whose recipient is the vault's NEAR deposit address. The visitor sends from the origin chain to the quote's depositAddress;
 * 1Click swaps through NEAR Intents and delivers on NEAR. Tiny amounts only: capped per origin asset below.
 */
export const FUND_ORIGINS = OC_ASSETS.filter((a) => a.chain !== "near");
export const FUND_DEST: Record<"usdc" | "wnear", string> = { usdc: OC_ASSETS[0].id, wnear: OC_ASSETS[1].id };
/** Max base units per origin asset (≈$5). */
export const FUND_MAX: Record<string, bigint> = Object.fromEntries(FUND_ORIGINS.map((a) => [a.id, a.id === "nep141:sol.omft.near" ? BigInt(30_000_000) : BigInt(5_000_000)]));
export const isNearAccount = (s: string) => /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(s);
export function refundOk(chain: string, a: string) {
  return chain === "sol" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) : /^0x[0-9a-fA-F]{40}$/.test(a);
}
export type FundReq = { origin: string; dest: "usdc" | "wnear"; amount: string; recipient: string; refundTo: string };
export function fundBody(r: FundReq, now = Date.now()): Record<string, unknown> | null {
  const o = FUND_ORIGINS.find((a) => a.id === r.origin);
  const dest = FUND_DEST[r.dest];
  if (!o || !dest || !/^\d{1,30}$/.test(r.amount) || BigInt(r.amount) <= BigInt(0) || BigInt(r.amount) > FUND_MAX[o.id]) return null;
  if (!isNearAccount(r.recipient) || !refundOk(o.chain, r.refundTo)) return null;
  return {
    dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: o.id, depositType: "ORIGIN_CHAIN", destinationAsset: dest,
    amount: r.amount, refundTo: r.refundTo, refundType: "ORIGIN_CHAIN", recipient: r.recipient, recipientType: "DESTINATION_CHAIN",
    deadline: new Date(now + 60 * 60_000).toISOString(),
  };
}
