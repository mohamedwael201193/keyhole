"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useWallet } from "./wallet";
import { nftTier, tokensFor, type Token } from "./near";
import { KEY_LIST_LIMIT } from "./keysApi";

export { KEY_LIST_LIMIT };

/**
 * The signed-in account's keys, read once and shared by every app route (mounted in components/app/AppShell.tsx).
 * Public contract reads only (nft_tokens_for_owner, then nft_tier of the first key): no signature, no session.
 * A read is kept per account in memory and in sessionStorage, so going back to a page shows the last answer at once and
 * a fresh read runs behind it. A failed revalidation keeps the last good answer; it never turns a key into "no key".
 */
export type KeyStatus = "idle" | "loading" | "ready" | "error";
/**
 * One read of an account's keys. The server route /api/keys answers first (its own RPC attempts, 4 s each, and a 15 s cache).
 * If that route is unreachable or fails, the browser reads the same two public views directly, as before.
 */
async function readKeys(accountId: string): Promise<{ keys: Token[]; tier: number | null }> {
  try {
    const r = await fetch(`/api/keys?account=${encodeURIComponent(accountId)}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (r.ok) {
      const j = (await r.json()) as { keys?: unknown; tier?: unknown };
      if (Array.isArray(j.keys)) return { keys: j.keys as Token[], tier: typeof j.tier === "number" ? j.tier : null };
    }
  } catch { /* fall through to the direct read */ }
  const keys = await tokensFor(accountId, KEY_LIST_LIMIT);
  const tier = keys[0] ? await nftTier(keys[0].token_id).catch(() => null) : null;
  return { keys, tier };
}

export type KeyEntry = { keys: Token[]; tier: number | null; at: number };

/** A cached read younger than this is shown without a new RPC call on route change. */
export const FRESH_MS = 20_000;
const STORE_PREFIX = "kh_keys_v1:";
const memory = new Map<string, KeyEntry>();

/** Whether a cached entry can be shown as it is, without a new read. Pure, so it is unit-tested. */
export function keyEntryFresh(entry: Pick<KeyEntry, "at"> | null, now: number, force = false): boolean {
  return !force && !!entry && now - entry.at < FRESH_MS;
}

function readStored(accountId: string): KeyEntry | null {
  try {
    const raw = sessionStorage.getItem(STORE_PREFIX + accountId);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<KeyEntry>;
    if (!Array.isArray(j.keys) || typeof j.at !== "number") return null;
    return { keys: j.keys as Token[], tier: typeof j.tier === "number" ? j.tier : null, at: j.at };
  } catch {
    return null;
  }
}

function writeStored(accountId: string, entry: KeyEntry) {
  try { sessionStorage.setItem(STORE_PREFIX + accountId, JSON.stringify(entry)); } catch { /* blocked storage: memory still works */ }
}

/** The last read for an account: memory first, then sessionStorage. */
export function cachedKeys(accountId: string): KeyEntry | null {
  const hit = memory.get(accountId) ?? readStored(accountId);
  if (hit) memory.set(accountId, hit);
  return hit;
}

export type KeyStore = {
  status: KeyStatus;
  accountId: string | null;
  /** Every key the account holds, up to KEY_LIST_LIMIT. */
  keys: Token[];
  /** The first key, or null. */
  primary: Token | null;
  /** nft_tier of the first key, or null when unreadable. */
  tier: number | null;
  /** True when the list is full (KEY_LIST_LIMIT), so the count is "50 or more". */
  capped: boolean;
  /** Reads the keys again now, whatever the cache says. */
  refresh: () => void;
};

type Snap = { accountId: string | null; status: KeyStatus; keys: Token[]; tier: number | null };
const EMPTY: Snap = { accountId: null, status: "idle", keys: [], tier: null };
const Ctx = createContext<KeyStore | null>(null);

export function KeyStoreProvider({ children }: { children: ReactNode }) {
  const { accountId } = useWallet();
  const path = usePathname();
  const [snap, setSnap] = useState<Snap>(EMPTY);
  const [round, setRound] = useState(0);
  const force = useRef(false);
  useEffect(()=>{const changed=()=>{force.current=true;setRound(n=>n+1);};window.addEventListener("keyhole:keys-changed",changed);return()=>window.removeEventListener("keyhole:keys-changed",changed);},[]);

  useEffect(() => {
    if (!accountId) { setSnap(EMPTY); return; }
    const hit = cachedKeys(accountId);
    if (hit) setSnap({ accountId, status: "ready", keys: hit.keys, tier: hit.tier });
    else setSnap({ accountId, status: "loading", keys: [], tier: null });
    if (keyEntryFresh(hit, Date.now(), force.current)) return;
    force.current = false;
    let cancel = false;
    void (async () => {
      try {
        const { keys, tier } = await readKeys(accountId);
        const entry: KeyEntry = { keys, tier, at: Date.now() };
        memory.set(accountId, entry);
        writeStored(accountId, entry);
        if (!cancel) setSnap({ accountId, status: "ready", keys, tier });
      } catch {
        if (!cancel) setSnap((p) => (p.accountId === accountId && p.status === "ready" ? p : { accountId, status: "error", keys: [], tier: null }));
      }
    })();
    return () => { cancel = true; };
  }, [accountId, path, round]);

  const refresh = useCallback(() => { force.current = true; setRound((n) => n + 1); }, []);

  // A snapshot for another account is never shown.
  const current = accountId && snap.accountId === accountId ? snap : accountId ? { ...EMPTY, status: "loading" as const, accountId } : EMPTY;
  const value = useMemo<KeyStore>(() => ({
    status: current.status,
    accountId: current.accountId,
    keys: current.keys,
    primary: current.keys[0] ?? null,
    tier: current.tier,
    capped: current.keys.length >= KEY_LIST_LIMIT,
    refresh,
  }), [current.status, current.accountId, current.keys, current.tier, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useKeyStore(): KeyStore {
  const c = useContext(Ctx);
  if (!c) throw new Error("KeyStoreProvider missing");
  return c;
}

/** The key store when the caller may render outside the provider (account menu): null instead of throwing. */
export function useKeyStoreOptional(): KeyStore | null {
  return useContext(Ctx);
}

/**
 * The holder's key as /vault and /swap read it, from the shared store (no lookup of their own). Pure, so it is unit-tested.
 * `lookingUp`: the first read for this account is still running (a cached answer is never "looking up").
 * `keyMiss`: the read settled with no key. `failed`: the read failed and there is no earlier answer to show.
 */
export function heldFrom(store: Pick<KeyStore, "status" | "primary" | "tier">, accountId: string | null) {
  return {
    held: store.primary ? { token: store.primary, tier: store.tier } : null,
    lookingUp: !!accountId && (store.status === "idle" || store.status === "loading"),
    keyMiss: !!accountId && store.status === "ready" && !store.primary,
    failed: !!accountId && store.status === "error" && !store.primary,
  };
}
