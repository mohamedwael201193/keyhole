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
