"use client";
import { useEffect, useState } from "react";
import { Overview, type ActivityView, type BalanceView, type KeysView } from "@/components/dashboard/Overview";
import { useWallet } from "@/lib/wallet";
import { useSigned } from "@/lib/useSigned";
import { KEY_LIST_LIMIT, NO_KEYS, useMyKeys } from "@/lib/useMyKeys";
import { useLogCheck } from "@/lib/useLogCheck";
import { assetRows, totalOf, type PriceBook } from "@/lib/amount";
import type { HistEntry } from "@/lib/dashboard";

type RawBalances = Parameters<typeof assetRows>[0];

/**
 * Overview container. It owns the reads and nothing else:
 *  - keys: public contract reads (nft_tokens_for_owner, nft_tier), no signature;
 *  - balance: the same signed `balance` op the vault uses (one wallet signature, or the live session);
 *  - activity: the same signed `history` op the vault uses, checked against the enclave's build before it is listed.
 * Nothing here adds a new auth path; the wallet and session logic is lib/wallet.tsx and lib/useSigned.ts.
 */
export function DashboardView() {
  const { accountId, restoring, session } = useWallet();
  const [attempt, setAttempt] = useState(0);
  const myKeys = useMyKeys(accountId, attempt);
  const balance = useSigned("balance");
  const history = useSigned("history");
  const [prices, setPrices] = useState<PriceBook>({});
  const { reset: resetBalance } = balance;
  const { reset: resetHistory } = history;

  // A read belongs to one account: switching or disconnecting clears what was read for the previous one.
  useEffect(() => { resetBalance(); resetHistory(); }, [accountId, resetBalance, resetHistory]);

  const keys = myKeys.accountId === accountId ? myKeys : NO_KEYS;
  const firstId = keys.tokens[0]?.token_id ?? null;
  const sessionLive = !!(session && firstId && session.token_id === firstId);

  const balances = balance.res?.output?.ok ? (balance.res.output.balances as RawBalances) : null;
  useEffect(() => {
    if (!balances) return;
    let cancel = false;
    fetch("/api/prices").then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!cancel && j?.prices) setPrices(j.prices);
    }).catch(() => {});
    return () => { cancel = true; };
  }, [balances]);
  const rows = balances ? assetRows(balances, prices) : null;

  const callId = history.res?.output?.ok ? history.res.call_id : null;
  const logOk = useLogCheck(callId);
  const entries = history.res?.output?.ok ? (history.res.output.entries as HistEntry[]) : null;

  const keysView: KeysView = {
    status: keys.status,
    count: keys.tokens.length,
    capped: keys.tokens.length >= KEY_LIST_LIMIT,
    tier: keys.tier,
    onRetry: () => setAttempt((n) => n + 1),
  };
  const balanceView: BalanceView = {
    read: !!rows,
    busy: balance.busy,
    busyLabel: balance.label || "Working…",
    sessionLive,
    total: rows ? totalOf(rows) : null,
    rows,
    error: balance.res?.error ?? null,
    onSign: () => { void balance.run({}); },
  };
  const activityView: ActivityView = {
    read: !!entries,
    busy: history.busy,
    busyLabel: history.label || "Working…",
    entries,
    logOk: entries ? logOk : null,
    callId,
    error: history.res?.error ?? null,
    onRead: () => { void history.run({}); },
  };

  return (
    <Overview
      accountId={accountId}
      restoring={restoring}
      keys={keysView}
      balance={balanceView}
      activity={activityView}
    />
  );
}
