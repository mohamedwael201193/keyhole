/**
 * Pure helpers for the Overview (app/dashboard). Every number they return comes from a real read: the contract (key count,
 * tier), the signed balance read, or the signed key history. Nothing here invents a figure.
 */
import { assetByToken, fromBaseUnits } from "./amount";
import { CAPS, type Finish } from "./traits";

/** One row of the signed key history (worker op `history`). Amounts are base units; `status` is the worker's word. */
export type HistEntry = {
  ts_ms?: number;
  kind?: string;
  token_in?: string;
  token_out?: string;
  amount_in?: string | number | null;
  amount_out?: string | number | null;
  token?: string;
  amount?: string | number | null;
  chain?: string;
  status?: string;
};

/** Tier to finish name, the same mapping the vault uses (tier 3 is Gold; Silver for 2; everything else Bronze). */
export function finishOf(tier: number | null | undefined): Finish {
  return tier === 3 ? "Gold" : tier === 2 ? "Silver" : "Bronze";
}

/**
 * Published per-trade and per-day caps for a tier, from the same table the vault shows before its live read.
 * Null when the tier is unknown, so the Overview never prints a cap for a key it cannot read.
 */
export function capsOf(tier: number | null | undefined): { perTx: number; daily: number } | null {
  if (tier !== 1 && tier !== 2 && tier !== 3) return null;
  const c = CAPS[finishOf(tier)];
  return { perTx: c.perTx, daily: c.daily };
}

/** "3 keys", "50 or more" when the list is full. Plain numbers, no rounding. */
export function keyCountText(count: number, capped: boolean): string {
  return capped ? `${count} or more` : String(count);
}

/** Settled orders on this key: successful swaps and copy trades in the signed history. */
export function settledOrders(entries: HistEntry[]): number {
  return entries.filter((e) => (e.kind === "swap" || e.kind === "copy") && e.status === "success").length;
}

/** Base units to a readable amount with its symbol when the token is in our asset list; the raw value otherwise. */
export function amountText(raw: string | number | null | undefined, token: string | undefined): string {
  const value = raw == null ? "" : String(raw);
  if (!value) return "—";
  const t = (token || "").trim();
  if (!t) return value;
  const asset = assetByToken(t);
  if (!asset) return `${value} ${t}`;
  return `${fromBaseUnits(value, asset.decimals)} ${asset.symbol}`;
}

const KIND: Record<string, string> = { swap: "Swap", copy: "Copy trade", withdraw: "Withdraw", deposit: "Deposit" };
export const kindLabel = (kind: string | undefined) => (kind && KIND[kind]) || (kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : "Entry");

/** One plain sentence per history row: what moved, from which token to which. */
export function entryDetail(e: HistEntry): string {
  if (e.token_in) return `${amountText(e.amount_in, e.token_in)} → ${amountText(e.amount_out, e.token_out)}`;
  if (e.kind === "withdraw" && e.chain) return `${amountText(e.amount, e.token)} to ${e.chain}`;
  return amountText(e.amount, e.token);
}

/**
 * Earned-tier progress as the enclave reports it (worker `tier_progress`, tee/worker/src/lib.rs). Every field is a real
 * number from the verified record; nothing here is estimated. `next` is null at the top tier.
 */
export type TierProgressRead = {
  current: number;
  next: number | null;
  swaps: number;
  volume_usd_micro: number;
  swaps_needed: number;
  volume_needed_usd_micro: number;
  swaps_done: boolean;
  volume_done: boolean;
  met: boolean;
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The progress from a dashboard or level_up output, or null when any field is missing or not a number (nothing is guessed). */
export function progressOf(raw: unknown): TierProgressRead | null {
  const p = raw as Partial<Record<keyof TierProgressRead, unknown>> | null | undefined;
  if (!p || typeof p !== "object") return null;
  const next = p.next === null ? null : isNum(p.next) ? p.next : undefined;
  if (next === undefined) return null;
  if (!isNum(p.current) || !isNum(p.swaps) || !isNum(p.volume_usd_micro) || !isNum(p.swaps_needed) || !isNum(p.volume_needed_usd_micro)) return null;
  if (typeof p.swaps_done !== "boolean" || typeof p.volume_done !== "boolean" || typeof p.met !== "boolean") return null;
  return {
    current: p.current, next, swaps: p.swaps, volume_usd_micro: p.volume_usd_micro, swaps_needed: p.swaps_needed,
    volume_needed_usd_micro: p.volume_needed_usd_micro, swaps_done: p.swaps_done, volume_done: p.volume_done, met: p.met,
  };
}

/** A bar's fill for `done` of `needed`, 0 to 100. A target of 0 is already met. */
export function meterPct(done: number, needed: number): number {
  if (!(needed > 0)) return 100;
  return Math.max(0, Math.min(100, Math.floor((done / needed) * 100)));
}

/** The result of a level_up call that raised the tier (it sends nft_set_tier); null when nothing was raised. */
export function levelUpOf(raw: unknown): { tierBefore: number; tierAfter: number; txHash: string } | null {
  const o = raw as { tier_before?: unknown; tier_after?: unknown; tx_hash?: unknown } | null | undefined;
  if (!o || typeof o.tx_hash !== "string" || o.tx_hash.length === 0) return null;
  if (!isNum(o.tier_before) || !isNum(o.tier_after)) return null;
  return { tierBefore: o.tier_before, tierAfter: o.tier_after, txHash: o.tx_hash };
}
