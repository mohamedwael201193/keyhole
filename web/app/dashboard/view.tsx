"use client";
import { useEffect, useState } from "react";
import { Overview, type ActivityView, type BalanceView, type KeysView, type TierView, type UnlockView } from "@/components/dashboard/Overview";
import { useWallet } from "@/lib/wallet";
import { useSigned } from "@/lib/useSigned";
import { formatUpdatedAgo, useNow, useVaultData } from "@/lib/vaultData";
import { useKeyStore } from "@/lib/keyStore";
import { useLogCheck } from "@/lib/useLogCheck";
import { assetRows, totalOf, type PriceBook } from "@/lib/amount";
import { minutesLeft } from "@/lib/session";
import { useValueLock } from "@/lib/valueLock";
import { levelUpOf, progressOf, type HistEntry } from "@/lib/dashboard";
import { vaultCacheInvalidate } from "@/lib/vaultCache";
import { PayoutCredit } from "@/components/PayoutCredit";
import { LIMITS_FLAG } from "@/lib/start";

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
  // The signed reads (balance, history, dashboard) come from the single app-level provider (lib/vaultData):
  // one stale-while-revalidate read per op, shared by every app page, so tab navigation shows the last answer
  // instantly instead of re-running the ~8 s attested read. Only the level-up mutation stays local.
  const { balance, history, dash } = useVaultData();
  const levelUp = useSigned("level_up");
  const [prices, setPrices] = useState<PriceBook>({});
  const { run: runBalance } = balance;
  const { run: runHistory } = history;
  const { run: runDash } = dash;
  const { run: runLevel, reset: resetLevel } = levelUp;
  const { refresh: refreshKeys } = store;
  const valueLock = useValueLock();
  const [unlocking, setUnlocking] = useState(false);
  const [unlockErr, setUnlockErr] = useState<string | null>(null);
  const now = useNow();
  // Before this container has mounted, the wallet has not said whether a session exists yet: treat the page as
  // still restoring, so a signed-in holder never sees the signed-out view ("Open your key" / "Sign in") flash
  // on a full load before the wallet hydrates.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // Whether this account has chosen safe limits (the same flag the old /start limits step set).
  // Read after mount so the server render and the first client render agree.
  const [limitsDone, setLimitsDone] = useState(false);
  useEffect(() => { if (accountId) setLimitsDone(localStorage.getItem(`${LIMITS_FLAG}:${accountId}`) === "1"); else setLimitsDone(false); }, [accountId]);

  // A level-up result belongs to one account: switching or disconnecting clears it. (The provider clears the
  // shared reads itself on an account change.)
  useEffect(() => { resetLevel(); }, [accountId, resetLevel]);

  const live = !!(session && tokenId && session.account === accountId && session.token_id === tokenId && minutesLeft(session) > 0);

  const balances = balance.res?.output?.ok ? (balance.res.output.balances as RawBalances) : null;
  const hasBalances = !!balances;
  useEffect(() => {
    if (!hasBalances) return;
    let cancel = false;
    fetch("/api/prices").then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!cancel && j?.prices) setPrices((prev) => ({ ...prev, ...j.prices }));
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
  // The level up changed the tier progress the dashboard read carries, so that cached read is dropped first.
  const levelOut = levelUp.res?.output?.ok ? levelUp.res.output : null;
  const levelled = levelUpOf(levelOut);
  const levelHash = levelled?.txHash ?? null;
  useEffect(() => {
    if (!levelHash) return;
    refreshKeys();
    vaultCacheInvalidate(accountId, "dashboard");
    void runDash({}, { cached: true, fresh: true });
  }, [levelHash, refreshKeys, runDash, accountId]);

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
    updatedAgo: formatUpdatedAgo(balance.updatedAt, now),
    onRead: () => { void runBalance({}, { cached: true, fresh: true }); },
  };
  const activityView: ActivityView = {
    read: !!entries,
    busy: history.busy,
    busyLabel: history.label || "Working…",
    entries,
    logOk: entries ? logOk : null,
    callId,
    error: history.res?.error ?? null,
    updatedAgo: formatUpdatedAgo(history.updatedAt, now),
    onRead: () => { void runHistory({}, { cached: true, fresh: true }); },
  };
  const tierView: TierView = {
    read: !!dashOut,
    busy: dash.busy,
    busyLabel: dash.label || "Working…",
    progress,
    unverifiable: !!dashOut && progress === null,
    error: dash.res?.error ?? null,
    updatedAgo: formatUpdatedAgo(dash.updatedAt, now),
    onRead: () => { void runDash({}, { cached: true, fresh: true }); },
    levelBusy: levelUp.busy,
    levelLabel: levelUp.label || "Working…",
    levelError: levelUp.res?.error ?? null,
    levelled,
    noRaise: !!levelOut && !levelled,
    onLevelUp: () => { void runLevel({}); },
  };
  const overviewProps: React.ComponentProps<typeof Overview> = {
    accountId,
    restoring: restoring || !mounted,
    keys: keysView,
    unlock: unlockView,
    balance: balanceView,
    activity: activityView,
    tier: tierView,
    valueLocked: valueLock.locked,
    limitsDone,
    signIn: {
      socialEnabled,
      onGoogle: () => connectSocial("google"),
      onEmail: () => connectSocial("email"),
      onNear: () => { void connectNear(); },
      onMeteor: () => connectMeteor(),
      onOther: () => { void connectOther(); },
    },
  };

  return (
    <>
      {/* The payout notice lives on the holder's home page (it owns payout), not site-wide in the shell. */}
      <PayoutCredit />
      <Overview {...overviewProps} />
    </>
  );
}
