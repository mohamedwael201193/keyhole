/**
 * Shared by the server route /api/keys and the key store. Pure: no server or browser imports, so both sides and the unit
 * tests can use it. Account ids are checked before any RPC call; the cache holds one answer per account for 15 seconds.
 */
export const KEY_LIST_LIMIT = 50;
/** One RPC attempt gives up after this long; lib/rpc.ts then tries the next configured endpoint. */
export const KEYS_RPC_TIMEOUT_MS = 4_000;
/** The server keeps an answer per account this long. */
export const KEYS_CACHE_MS = 15_000;
const MAX_ENTRIES = 500;

/** NEAR named accounts (2 to 64 characters, lowercase, dots and single separators) and implicit accounts (64 hex). */
const NAMED = /^(?=.{2,64}$)[a-z\d]+(?:[-_][a-z\d]+)*(?:\.[a-z\d]+(?:[-_][a-z\d]+)*)*$/;
const IMPLICIT = /^[a-f\d]{64}$/;

export function validAccountId(id: unknown): id is string {
  return typeof id === "string" && (NAMED.test(id) || IMPLICIT.test(id));
}

/** A small time-limited map keyed by account. Expired entries are dropped on read; the oldest go first past the cap. */
export class AccountCache<T> {
  private readonly map = new Map<string, { at: number; value: T }>();
  constructor(private readonly ttlMs = KEYS_CACHE_MS, private readonly max = MAX_ENTRIES) {}

  get(key: string, now: number): T | null {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (now - hit.at >= this.ttlMs) { this.map.delete(key); return null; }
    return hit.value;
  }

  set(key: string, value: T, now: number): void {
    this.map.delete(key);
    this.map.set(key, { at: now, value });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}
