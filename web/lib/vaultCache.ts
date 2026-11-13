"use client";
import type { WorkerResult } from "./worker";

/**
 * Session-scoped cache for the vault's signed reads (balance, history, dashboard, limits).
 * The model is lib/keyStore.tsx: a read is kept per account in memory and in sessionStorage, so going back to a page
 * shows the last answer at once and a fresh read runs only when the entry is stale or a mutation invalidated it.
 *
 * What is cached: no-parameter signed reads only. A quote, a swap, a withdraw, a limits set and a deposit-address
 * read are never cached (a quote is per-trade, a mutation changes state, a deposit address depends on its amount).
 * The key carries the account AND the session token, so a new session never hits an old session's entry, and a
 * different account never sees another account's reads. The cache is cleared with the session (lib/session.ts
 * clearSession calls clearVaultCache), so locking the session seals the reads again.
 * TTL is 300 s (5 min): long enough that a real browsing session never re-reads on tab navigation (a reader
 * spends a minute or more per page), short enough that a path without an explicit invalidation (a deposit, a
 * list/unlist) corrects itself within minutes. Explicit refresh and every mutation invalidate first and re-read.
 * Stale-while-revalidate: a stale entry is still served instantly (see vaultCacheGetStale) while a background
 * revalidation runs, so a return visit never waits on the ~8 s attested read.
 */

export const VAULT_CACHE_TTL_MS = 300_000;
const PREFIX = "kh_vault_v1:";
const memory = new Map<string, { entry: WorkerResult; at: number }>();

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "length" | "key">;
function sessionStore(): Store | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    return null;
  }
}

/** The cache key for one account, one session and one read op. Null when there is no live session to scope it to. */
export function vaultCacheKey(accountId: string | null | undefined, sessionToken: string | null | undefined, op: string): string | null {
  if (!accountId || !sessionToken || !op) return null;
  return `${PREFIX}${accountId}:${sessionToken}:${op}`;
}

/** Whether a cached entry is young enough to show without a new read. Pure, so it is unit-tested. */
export function vaultCacheFresh(at: number, now = Date.now()): boolean {
  return now - at < VAULT_CACHE_TTL_MS;
}

/** The cached read for a key, or null. A stale entry is dropped, never served. */
export function vaultCacheGet(key: string | null, now = Date.now(), store: Store | null = sessionStore()): WorkerResult | null {
  if (!key) return null;
  const hit = memory.get(key);
  if (hit) {
    if (vaultCacheFresh(hit.at, now)) return hit.entry;
    memory.delete(key);
  }
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const j = JSON.parse(raw) as { entry?: WorkerResult; at?: unknown };
    if (!j || typeof j.at !== "number" || !j.entry || typeof j.entry !== "object" || !vaultCacheFresh(j.at, now)) {
      try { store.removeItem(key); } catch { /* blocked storage: the entry is already unusable */ }
      return null;
    }
    memory.set(key, { entry: j.entry, at: j.at });
    return j.entry;
  } catch {
    return null;
  }
}

/**
 * The cached read for a key EVEN WHEN STALE, with the time it was stored — the stale-while-revalidate serve.
 * Never deletes: a stale entry stays available to show instantly while a background revalidation runs. The
 * caller decides freshness (vaultCacheFresh) and revalidates when stale.
 */
export function vaultCacheGetStale(key: string | null, store: Store | null = sessionStore()): { entry: WorkerResult; at: number } | null {
  if (!key) return null;
  const hit = memory.get(key);
  if (hit) return { entry: hit.entry, at: hit.at };
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const j = JSON.parse(raw) as { entry?: WorkerResult; at?: unknown };
    if (!j || typeof j.at !== "number" || !j.entry || typeof j.entry !== "object") return null;
    memory.set(key, { entry: j.entry, at: j.at });
    return { entry: j.entry, at: j.at };
  } catch {
    return null;
  }
}

/** Store a signed read under its key. A blocked or full store never fails the read: memory still works. */
export function vaultCacheSet(key: string | null, entry: WorkerResult, store: Store | null = sessionStore()): void {
  if (!key || !entry || typeof entry !== "object") return;
  const v = { entry, at: Date.now() };
  memory.set(key, v);
  if (!store) return;
  try { store.setItem(key, JSON.stringify(v)); } catch { /* blocked storage: memory still works */ }
}

function isVaultKey(k: string | null, accountId: string | null | undefined, op?: string): boolean {
  if (!k || !k.startsWith(PREFIX)) return false;
  if (accountId && !k.startsWith(`${PREFIX}${accountId}:`)) return false;
  if (op && !k.endsWith(`:${op}`)) return false;
  return true;
}

/**
 * Drop cached reads: every op for one account, or one op for one account (a mutation invalidates only what it
 * changed). Pass no account to drop everything (used when the session is cleared).
 */
export function vaultCacheInvalidate(accountId: string | null | undefined, op?: string, store: Store | null = sessionStore()): void {
  for (const k of [...memory.keys()]) if (isVaultKey(k, accountId, op)) memory.delete(k);
  if (!store) return;
  const doomed: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (isVaultKey(k, accountId, op)) doomed.push(k!);
    }
    for (const k of doomed) store.removeItem(k);
  } catch { /* blocked storage: the memory entries are already gone */ }
}

/** Drop every cached vault read, for every account. Called when the session is cleared (lib/session.ts). */
export function clearVaultCache(store: Store | null = sessionStore()): void {
  vaultCacheInvalidate(null, undefined, store);
}
