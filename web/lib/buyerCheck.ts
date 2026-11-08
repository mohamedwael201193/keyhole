// What a buyer can read about a key's holder from the enclave's signed log (provenance op) and the chain owner.
// Mirrors the enclave rules in tee/worker/src/lib.rs: cooldown_until, TRANSFER_COOLDOWN_MS, MAX_LOCK_HOURS and active_lock.
import type { KeyEvent } from "./keylog";

export const TRANSFER_COOLDOWN_MS = 600_000;
/** A seller lock lasts at most 168 hours from the lock call (MAX_LOCK_HOURS). */
export const MAX_LOCK_MS = 168 * 3_600_000;

export type Cooldown =
  | { state: "active"; until: number }
  | { state: "over"; until: number }
  | { state: "none" }
  | { state: "unknown" };

export type SellerLock =
  | { state: "possible"; endsBy: number }
  | { state: "ended"; endsBy: number }
  | { state: "none" }
  | { state: "unknown" };

/** The latest transfer row: the moment the enclave first saw this owner. */
export function latestTransfer(events: KeyEvent[]): KeyEvent | null {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].kind === "transfer") return events[i];
  return null;
}

/**
 * Withdraw cooldown for `owner`. It runs TRANSFER_COOLDOWN_MS after the latest transfer row, when that row names the owner.
 * Unknown while the log's last row is not by this owner: the enclave has not recorded the current holder yet.
 */
export function cooldownFor(events: KeyEvent[], owner: string | null | undefined, nowMs: number): Cooldown {
  if (!owner) return { state: "unknown" };
  const last = events[events.length - 1];
  if (!last || last.owner !== owner) return { state: "unknown" };
  const t = latestTransfer(events);
  if (!t || t.owner !== owner) return { state: "none" };
  const until = t.ts_ms + TRANSFER_COOLDOWN_MS;
  return nowMs < until ? { state: "active", until } : { state: "over", until };
}

/**
 * Seller lock for `owner`. The enclave keeps one lock per key, so only the latest lock row counts, and only when its
 * owner is the current holder. The exact end is private (it sits in the lock detail), so the log can only bound it:
 * a lock ends no later than 168 hours after the latest lock row.
 */
export function lockFor(events: KeyEvent[], owner: string | null | undefined, nowMs: number): SellerLock {
  if (!owner) return { state: "unknown" };
  let last: KeyEvent | null = null;
  for (let i = events.length - 1; i >= 0; i--) if (events[i].kind === "lock") { last = events[i]; break; }
  if (!last || last.owner !== owner) return { state: "none" };
  const endsBy = last.ts_ms + MAX_LOCK_MS;
  return nowMs < endsBy ? { state: "possible", endsBy } : { state: "ended", endsBy };
}
