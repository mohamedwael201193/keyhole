"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useWallet } from "./wallet";
import { useKeyStore } from "./keyStore";
import { useSigned } from "./useSigned";
import { minutesLeft } from "./session";
import { vaultCacheInvalidate, vaultCacheKey } from "./vaultCache";

/**
 * ONE data provider for the vault's signed reads (balance, history, dashboard), mounted once at the app-shell
 * level (components/app/AppShell.tsx) so every app page shares the same reads instead of each page re-reading
 * the ~8 s attested read on every navigation.
 *
 * Stale-while-revalidate, keyed by account + session token + op, persisted in sessionStorage (lib/vaultCache):
 * a return visit shows the last answer instantly with "updated Xs ago"; a background revalidation refreshes it
 * without a busy indicator; a manual refresh or any mutation invalidates first and re-reads fresh. The reads run
 * by themselves only while the 30-minute session is live (no popup). A read belongs to one account: switching or
 * disconnecting clears what was read for the previous one.
 */

export type VaultRead = ReturnType<typeof useSigned>;

export type VaultData = {
  balance: VaultRead;
  history: VaultRead;
  dash: VaultRead;
  /** Whether the session is live for the held key (the reads can run without a popup). */
  live: boolean;
  /** Drop the cached reads for this account and re-read them fresh (after a mutation or a manual refresh). */
  invalidateAll: () => void;
  /** Background revalidation of all three reads: serve the last values, refresh quietly. */
  refreshAll: () => void;
};

const Ctx = createContext<VaultData | null>(null);

export function useVaultData(): VaultData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useVaultData must be used inside VaultDataProvider (components/app/AppShell.tsx)");
  return v;
}

/** "Updated 12s ago" / "Updated 3m ago" / "Updated just now", from the stored time of the shown answer. Pure. */
export function formatUpdatedAgo(updatedAt: number | null | undefined, now = Date.now()): string | null {
  if (!updatedAt) return null;
  const s = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (s < 5) return "Updated just now";
  if (s < 60) return `Updated ${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `Updated ${m}m ago`;
  return `Updated ${Math.floor(m / 60)}h ago`;
}

/** A clock that ticks every `intervalMs` so an "updated Xs ago" label stays current. */
export function useNow(intervalMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function VaultDataProvider({ children }: { children: ReactNode }) {
  const { accountId, session } = useWallet();
  const store = useKeyStore();
  const tokenId = store.primary?.token_id ?? null;
  const balance = useSigned("balance", { cacheKey: vaultCacheKey(accountId, session?.token ?? null, "balance") });
  const history = useSigned("history", { cacheKey: vaultCacheKey(accountId, session?.token ?? null, "history") });
  const dash = useSigned("dashboard", { cacheKey: vaultCacheKey(accountId, session?.token ?? null, "dashboard") });
  const { run: runBalance, reset: resetBalance } = balance;
  const { run: runHistory, reset: resetHistory } = history;
  const { run: runDash, reset: resetDash } = dash;

  const live = !!(session && tokenId && session.account === accountId && session.token_id === tokenId && minutesLeft(session) > 0);

  // A read belongs to one account: switching or disconnecting clears what was read for the previous one.
  // (Only on a real change — not on mount — so a return visit keeps the last answer on screen.)
  const prevAccount = useRef(accountId);
  useEffect(() => {
    if (prevAccount.current === accountId) return;
    prevAccount.current = accountId;
    resetBalance(); resetHistory(); resetDash();
  }, [accountId, resetBalance, resetHistory, resetDash]);

  // With a live session the signed reads load by themselves, once per session. A failure is shown with a retry;
  // it never re-runs by itself, so a bad read cannot loop. Stale-while-revalidate: a cached answer (fresh or
  // stale) is shown at once and the revalidation runs in the background, so tab navigation never re-reads.
  const autoFor = useRef<string | null>(null);
  useEffect(() => {
    if (!live || !tokenId || !accountId) { autoFor.current = null; return; }
    const key = `${accountId}:${tokenId}:${session?.token ?? ""}`;
    if (autoFor.current === key) return;
    autoFor.current = key;
    void runBalance({}, { quiet: true, cached: true, background: true });
    void runHistory({}, { quiet: true, cached: true, background: true });
    void runDash({}, { quiet: true, cached: true, background: true });
  }, [live, tokenId, accountId, session, runBalance, runHistory, runDash]);

  const invalidateAll = useCallback(() => {
    vaultCacheInvalidate(accountId, "balance");
    vaultCacheInvalidate(accountId, "history");
    vaultCacheInvalidate(accountId, "dashboard");
    if (!live) return;
    void runBalance({}, { quiet: true, cached: true, fresh: true });
    void runHistory({}, { quiet: true, cached: true, fresh: true });
    void runDash({}, { quiet: true, cached: true, fresh: true });
  }, [accountId, live, runBalance, runHistory, runDash]);

  const refreshAll = useCallback(() => {
    if (!live) return;
    void runBalance({}, { quiet: true, cached: true, background: true });
    void runHistory({}, { quiet: true, cached: true, background: true });
    void runDash({}, { quiet: true, cached: true, background: true });
  }, [live, runBalance, runHistory, runDash]);

  return <Ctx.Provider value={{ balance, history, dash, live, invalidateAll, refreshAll }}>{children}</Ctx.Provider>;
}
