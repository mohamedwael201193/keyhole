"use client";
import { useEffect, useRef, useState } from "react";
import { Overview, type ActivityView, type BalanceView, type KeysView, type TierView, type UnlockView } from "@/components/dashboard/Overview";
import { useWallet } from "@/lib/wallet";
import { useSigned } from "@/lib/useSigned";
import { useKeyStore } from "@/lib/keyStore";
import { useLogCheck } from "@/lib/useLogCheck";
import { assetRows, totalOf, type PriceBook } from "@/lib/amount";
import { minutesLeft } from "@/lib/session";
import { levelUpOf, progressOf, type HistEntry } from "@/lib/dashboard";

type RawBalances = Parameters<typeof assetRows>[0];

/**
 * Overview container. It owns the reads and nothing else:
 *  - keys: the shared key store (components/app/AppShell.tsx mounts it), public reads, no signature;
 *  - balance and activity: the same signed `balance` and `history` ops the vault uses. They run by themselves only while the
 *    30-minute session is live (no popup); otherwise the page shows one "Unlock to read" line that starts the same session;
 *  - unlock: startSession for the first key, the same call the top-bar pill makes.
 * Nothing here adds a new auth path; the wallet and session logic is lib/wallet.tsx and lib/useSigned.ts.
 */
export function DashboardView() {
  const { accountId, restoring, session, startSession, via, socialEnabled, connectSocial, connectNear, connectMeteor, connectOther } = useWallet();
  const store = useKeyStore();
  const tokenId = store.primary?.token_id ?? null;
  const balance = useSigned("balance");
  const history = useSigned("history");
  const dash = useSigned("dashboard");
  const levelUp = useSigned("level_up");
  const [prices, setPrices] = useState<PriceBook>({});
  const { run: runBalance, reset: resetBalance } = balance;
  const { run: runHistory, reset: resetHistory } = history;
  const { run: runDash, reset: resetDash } = dash;
  const { run: runLevel, reset: resetLevel } = levelUp;
  const { refresh: refreshKeys } = store;
  const [unlocking, setUnlocking] = useState(false);
  const [unlockErr, setUnlockErr] = useState<string | null>(null);

  // A read belongs to one account: switching or disconnecting clears what was read for the previous one.
  useEffect(() => { resetBalance(); resetHistory(); resetDash(); resetLevel(); }, [accountId, resetBalance, resetHistory, resetDash, resetLevel]);

  const live = !!(session && tokenId && session.account === accountId && session.token_id === tokenId && minutesLeft(session) > 0);

  // With a live session the signed reads load by themselves, once per session. A failure is shown with a retry; it
  // never re-runs by itself, so a bad read cannot loop.
  const autoFor = useRef<string | null>(null);
  useEffect(() => {
    if (!live || !tokenId || !accountId) { autoFor.current = null; return; }
    const key = `${accountId}:${tokenId}`;
    if (autoFor.current === key) return;
    autoFor.current = key;
    void runBalance({});
    void runHistory({});
    void runDash({});
  }, [live, tokenId, accountId, runBalance, runHistory, runDash]);

  const balances = balance.res?.output?.ok ? (balance.res.output.balances as RawBalances) : null;
  const hasBalances = !!balances;
  useEffect(() => {
    if (!hasBalances) return;
    let cancel = false;
    fetch("/api/prices").then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!cancel && j?.prices) setPrices(j.prices);
    }).catch(() => {});
    return () => { cancel = true; };
  }, [hasBalances]);
  const rows = balances ? assetRows(balances, prices) : null;

  const callId = history.res?.output?.ok ? history.res.call_id : null;
  const logOk = useLogCheck(callId);
  const entries = history.res?.output?.ok ? (history.res.output.entries as HistEntry[]) : null;

  // Tier progress: the enclave's own numbers from the signed dashboard read. A null progress means the record did not verify.
  const dashOut = dash.res?.output?.ok ? dash.res.output : null;
  const progress = dashOut ? progressOf(dashOut.progress) : null;
  // A level up that raised the tier: the chain now holds it, so the key store and the progress are read again.
  const levelOut = levelUp.res?.output?.ok ? levelUp.res.output : null;
  const levelled = levelUpOf(levelOut);
  const levelHash = levelled?.txHash ?? null;
  useEffect(() => {
    if (!levelHash) return;
    refreshKeys();
    void runDash({});
  }, [levelHash, refreshKeys, runDash]);

  const unlock = async () => {
    if (!tokenId) return;
    setUnlocking(true); setUnlockErr(null);
    const r = await startSession(tokenId);
    setUnlocking(false);
    if (!r.ok) setUnlockErr(r.code);
  };

  const keysView: KeysView = {
    status: store.status,
    count: store.keys.length,
    capped: store.capped,
    primary: store.primary,
    tier: store.tier,
    onRetry: store.refresh,
  };
  const unlockView: UnlockView = {
    live,
    minutes: live ? minutesLeft(session) : 0,
    busy: unlocking,
    busyLabel: via === "privy" ? "Signing in-page…" : "Confirm in your wallet…",
    via,
    error: unlockErr,
    onUnlock: () => { void unlock(); },
  };
  const balanceView: BalanceView = {
    read: !!rows,
    busy: balance.busy,
    busyLabel: balance.label || "Working…",
    total: rows ? totalOf(rows) : null,
    rows,
    error: balance.res?.error ?? null,
    onRead: () => { void runBalance({}); },
  };
  const activityView: ActivityView = {
    read: !!entries,
    busy: history.busy,
    busyLabel: history.label || "Working…",
    entries,
    logOk: entries ? logOk : null,
    callId,
    error: history.res?.error ?? null,
    onRead: () => { void runHistory({}); },
  };
  const tierView: TierView = {
    read: !!dashOut,
    busy: dash.busy,
    busyLabel: dash.label || "Working…",
    progress,
    unverifiable: !!dashOut && progress === null,
    error: dash.res?.error ?? null,
    onRead: () => { void runDash({}); },
    levelBusy: levelUp.busy,
    levelLabel: levelUp.label || "Working…",
    levelError: levelUp.res?.error ?? null,
    levelled,
    noRaise: !!levelOut && !levelled,
    onLevelUp: () => { void runLevel({}); },
  };

  return (
    <Overview
      accountId={accountId}
      restoring={restoring}
      keys={keysView}
      unlock={unlockView}
      balance={balanceView}
      activity={activityView}
      tier={tierView}
      signIn={{
        socialEnabled,
        onGoogle: () => connectSocial("google"),
        onEmail: () => connectSocial("email"),
        onNear: () => { void connectNear(); },
        onMeteor: () => connectMeteor(),
        onOther: () => { void connectOther(); },
      }}
    />
  );
}
