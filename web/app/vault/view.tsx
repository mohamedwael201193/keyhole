"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Attested, ErrorBox, OfflineState, capFrom } from "@/components/Result";
import { TxLink } from "@/components/TxLink";
import { loadMintTx } from "@/lib/mintTx";
import { HowStrip } from "@/components/HowStrip";
import { Cipher } from "@/components/Cipher";
import { KeyArt } from "@/components/Art";
import { FoilCard } from "@/components/FoilCard";
import { TokenMark } from "@/components/TokenMark";
import { errorText, useI18n } from "@/lib/i18n";
import { useWallet, OP_CTX, type OpResume } from "@/lib/wallet";
import { useSigned } from "@/lib/useSigned";
import { encodeShare } from "@/lib/pnl";
import { useHealth } from "@/lib/useHealth";
import { heldFrom, useKeyStore } from "@/lib/keyStore";
import { useLogVerified, useLogVerifiedState } from "@/lib/useLogVerified";
import { ASSETS, toBaseUnits, type AssetKey } from "@/lib/assets";
import { fundParams, withdrawParams } from "@/lib/trade";
import { defaultDestination, validDestination } from "@/lib/destination";
import { chainName } from "@/lib/tokens";
import { keyState, shortAccount, shortKeyId } from "@/lib/near";
import { acct, tx, KEYS_CONTRACT } from "@/lib/config";
import { minutesLeft } from "@/lib/session";
import { LOCK_LABEL, LOCK_NOTE, useValueLock } from "@/lib/valueLock";
import { ValueRecovery } from "@/components/ValueRecovery";
import { Details, InCardFailure, InCardProgress, InCardSuccess } from "@/components/InCard";
import { isNotSent } from "@/lib/opResult";
import { OpNotSent } from "@/components/OpNotSent";
import { TeeProgress } from "@/components/TeeProgress";
import { DepositQr } from "@/components/DepositQr";
import { FundFromChain } from "@/components/FundFromChain";
import { FundOrderCard } from "@/components/FundOrderCard";
import { FundOrderBanner } from "@/components/FundOrderBanner";
import { useFundOrder } from "@/lib/useFundOrder";
import { assetRows, formatUsdMicro, isImplicitAccount, totalOf, withdrawSummary, type PriceBook } from "@/lib/amount";
import { copyText } from "@/lib/copyText";
import { CAPS, keyIdentity, serialOf, type Finish } from "@/lib/traits";
import { traitLabel } from "@/components/KeyCard";
import { KeyLog } from "@/components/KeyLog";
import { entryDetail, kindLabel, settledOrders, type HistEntry } from "@/lib/dashboard";
import type { WorkerResult } from "@/lib/worker";
import { AmountInput, Button, Busy, Sheet, Tabs, TokenSelect, type TokenOption } from "@/components/ui";
import { TxStatus } from "@/components/ui/tx-status";
import { Card, CardHeader, CopyButton, EmptyState, Icon, ListRow, PageHeader, ProofPanel, SetupProgress, Skeleton, StatusChip, TierChip, VaultHero, type IconName, type SetupItem } from "@/components/v7";
import "./vault.css";
import { dashHref } from "@/lib/dashboardSections";

type Bal = { token?: string; symbol?: string; amount?: string; balance?: string; usd?: number; usd_micro?: number };
type DepTab = "direct" | "chain";
type DoneWithdraw = { amount: string; to: string };
type Panel = "limits" | "session";

const ASSET_KEYS = Object.keys(ASSETS) as AssetKey[];
const keyOfId = (id: string): AssetKey => ASSET_KEYS.find((k) => ASSETS[k].id === id) ?? "usdc";
/** The vault holds and withdraws the two assets the trade supports. */
const TOKEN_OPTIONS: TokenOption[] = ASSET_KEYS.map((k) => ({ id: ASSETS[k].id, symbol: ASSETS[k].symbol, name: ASSETS[k].name, assetId: ASSETS[k].id, chain: "near" }));

/** Icon, tone and one plain line for each kind of vault entry. The kind comes from the signed, verified history. */
const ENTRY_ICON: Record<string, IconName> = { deposit: "arrow-down", withdraw: "arrow-up", swap: "arrow-swap", copy: "swap" };
const ENTRY_TONE: Record<string, "success" | "warn" | "neutral"> = { deposit: "success", withdraw: "warn", swap: "neutral", copy: "neutral" };
const ENTRY_SUB: Record<string, string> = {
  deposit: "Funds added to the vault",
  withdraw: "Funds withdrawn from the vault",
  swap: "Private swap inside the vault",
  copy: "Copy trade inside the vault",
};

/** A labelled meter. The bar is drawn only when there is a real percentage to show. */
function Meter({ label, value, pct, note, testid }: { label: string; value: ReactNode; pct?: number; note?: string; testid?: string }) {
  const p = pct == null ? null : Math.max(0, Math.min(100, pct));
  const tone = p == null ? "" : p >= 100 ? " full" : p >= 80 ? " warn" : "";
  return (
    <div className={`vlt-meter${tone}`}>
      <p className="vlt-meter-top"><span>{label}</span><span data-testid={testid}>{value}</span></p>
      {p != null && <div className="vlt-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)}><i style={{ width: `${p}%` }} /></div>}
      {note && <small>{note}</small>}
    </div>
  );
}

/** The refresh mark for the balance pill (the v7 icon set has no refresh glyph). */
function RefreshGlyph() {
  return (
    <svg className="vlt-pill-icon" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
    </svg>
  );
}

/** The call behind a read: its id, the attestation link when the enclave gave one, and Verify. Small, muted and mono. */
function CallLine({ r }: { r: WorkerResult }) {
  if (!r.call_id) return null;
  return (
    <p className="vlt-callline">
      <span>Call: {r.call_id.slice(0, 8)}</span>
      {r.attestation_url && <a className="v7-pill-link" href={r.attestation_url} target="_blank" rel="noreferrer"><span>Attestation</span><Icon name="external" size={14} /></a>}
      <Link className="v7-pill-link" href={dashHref(`/verify?call=${encodeURIComponent(r.call_id)}`)}><span>Verify</span></Link>
      {r.time_ms != null && <span>TEE time: {r.time_ms} ms</span>}
    </p>
  );
}

/** One row of the settings list. A row with `open` is a disclosure (it shows or hides a panel); without it, the row acts. */
function SettingRow({ testid, iconName, title, sub, tail, open, onClick }: {
  testid: string; iconName: IconName; title: string; sub: ReactNode; tail?: ReactNode; open?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="v7-row vlt-set-row"
      data-testid={testid}
      aria-expanded={open === undefined ? undefined : open}
      aria-controls={open === undefined ? undefined : "vlt-set-panel"}
      onClick={onClick}
    >
      <span className="v7-row-icon" aria-hidden="true"><Icon name={iconName} size={18} /></span>
      <span className="v7-row-body">
        <span className="v7-row-title">{title}</span>
        <span className="v7-row-sub">{sub}</span>
      </span>
      {tail}
      <Icon name={open ? "chevron-down" : "chevron-right"} size={18} className="v7-row-arrow" />
    </button>
  );
}

/**
 * The vault. Keys come from the shared key store (no lookup of its own). The vault is open only while the 30-minute session
 * for the holder's key is live: then the balance, the caps and the lock state read by themselves, once per session. With no
 * live session the page shows one "Unlock to read" action, which is the same unlock the top-bar pill uses. Deposit and
 * withdraw keep their own sheets; a withdrawal always asks the wallet for a fresh signature.
 * Layout (mockup 18): the page title, the balance banner, then two columns: assets, proof and activity on the left; the key,
 * setup progress and settings on the right. Every value is read from the enclave, the contract or the key store.
 */
export function VaultView({ initialOnline, initialPrices = {} }: { initialOnline: boolean; initialPrices?: PriceBook }) {
  const { t, fmtUsd } = useI18n();
  const { accountId, connect, pending, session, startSession, revokeSession } = useWallet();
  const online = useHealth(initialOnline);
  const store = useKeyStore();
  const { held, keyMiss, lookingUp, failed } = heldFrom(store, accountId);
  const balance = useSigned("balance");
  const account = useSigned("account");
  const history = useSigned("history");
  const withdraw = useSigned("exact_near_exit_v1");
  const limits = useSigned("limits");
  const pnl = useSigned("pnl");
  const dash = useSigned("dashboard");
  const logVerified = useLogVerified(history.res);
  const logState = useLogVerifiedState(history.res);
  // New value operations (withdraw here) are locked while an earlier one has no final answer. The worker refuses them too.
  const lock = useValueLock();

  const [panel, setPanel] = useState<Panel | null>(null);
  const [limTx, setLimTx] = useState("");
  const [limDay, setLimDay] = useState("");
  const [depOpen, setDepOpen] = useState(false);
  const [wOpen, setWOpen] = useState(false);
  const [fundAsset, setFundAsset] = useState<AssetKey>("usdc");
  const [fundAmt, setFundAmt] = useState("1");
  const [depTab, setDepTab] = useState<DepTab>("direct");
  const [fundedFor, setFundedFor] = useState<string | null>(null);
  const [wAsset, setWAsset] = useState<AssetKey>("usdc");
  const [wAmt, setWAmt] = useState("0.05");
  const [doneWithdraw, setDoneWithdraw] = useState<DoneWithdraw | null>(null);
  const [prices, setPrices] = useState(initialPrices);
  const [mintTx, setMintTx] = useState<string | null>(null);
  const [copiedConf, setCopiedConf] = useState(false);
  const [slowKey, setSlowKey] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockErr, setUnlockErr] = useState<string | null>(null);
  const fundUnits = toBaseUnits(fundAmt, ASSETS[fundAsset].decimals);
  // The vault's deposit target for the amount on screen. A target read for another asset or amount is stale and is not used.
  const fundKey = `${fundAsset}:${fundUnits ?? ""}`;
  const fundedDeposit = account.res?.output?.ok && fundedFor === fundKey && typeof account.res.output.deposit?.deposit_address === "string" ? String(account.res.output.deposit.deposit_address) : null;
  const wUnits = toBaseUnits(wAmt, ASSETS[wAsset].decimals);
  const wAddr = defaultDestination("near", accountId ?? "");
  const wDest = validDestination("near", wAddr);
  const utcReset = (() => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); })();

  const heldId = held?.token.token_id ?? null;
  // The saved "from another chain" order for this key: shown on the page banner and at the top of the Deposit sheet.
  const fo = useFundOrder(accountId, heldId);
  // Live: a session for this account and this key that has not run out.
  const live = !!(session && heldId && session.account === accountId && session.token_id === heldId && minutesLeft(session) > 0);
  const sessionToken = live && session ? session.token : "";

  // One automatic read per session: the balance, the dashboard (caps, lock state) and the signed history. Guarded by the
  // session token, so it cannot loop; a failure shows a retry and never re-runs by itself.
  const runBalance = balance.run;
  const runDash = dash.run;
  const runHistory = history.run;
  const autoFor = useRef("");
  useEffect(() => {
    if (!sessionToken) { autoFor.current = ""; return; }
    if (autoFor.current === sessionToken) return;
    autoFor.current = sessionToken;
    void runBalance({}, { quiet: true });
    void runDash({}, { quiet: true });
    void runHistory({}, { quiet: true });
  }, [sessionToken, runBalance, runDash, runHistory]);

  // The newest signed read on this page: each finished read that carries a call id becomes the last call.
  const [lastRes, setLastRes] = useState<WorkerResult | null>(null);
  const seenRes = useRef<(WorkerResult | null | undefined)[]>([]);
  useEffect(() => {
    const before = seenRes.current;
    const now = [balance.res, account.res, history.res, withdraw.res, limits.res, pnl.res, dash.res];
    seenRes.current = now;
    const fresh = now.find((r, i) => !!r && r !== before[i] && !!r.call_id);
    if (fresh) setLastRes(fresh);
  }, [balance.res, account.res, history.res, withdraw.res, limits.res, pnl.res, dash.res]);
  const lastCall = lastRes?.call_id ?? null;
  const lastVerified = useLogVerified(lastRes);

  useEffect(() => { setMintTx(loadMintTx(accountId)); }, [accountId]);
  useEffect(() => { setSlowKey(false); if (!lookingUp) return; const id = setTimeout(() => setSlowKey(true), 12_000); return () => clearTimeout(id); }, [lookingUp]);

  // Balances and state are shown only while the session is live: after a lock or an expiry the page is sealed again.
  const d: Record<string, any> | null = dash.res?.output?.ok && live ? (dash.res.output as Record<string, any>) : null;
  const s: Record<string, any> | undefined = d ? { ...d, ok: true } : undefined;
  const tierNum = (s?.ok ? Number(s.tier) : held?.tier) || null;
  const finish: Finish = tierNum === 3 ? "Gold" : tierNum === 2 ? "Silver" : "Bronze";
  const lo = limits.res?.output;
  const caps = lo?.ok ? lo.limits : s?.ok ? s.limits : null;
  const usdMicro = (v: string) => (/^\d+(\.\d{1,6})?$/.test(v.trim()) ? Math.round(Number(v) * 1e6) : 0);
  const pendingLim = (lo?.ok ? lo.holder_limits?.pending : s?.ok ? s.holder_limits?.pending : null) as { per_tx_usd_micro: number; daily_usd_micro: number; effective_ms: number } | null | undefined;
  const coolUntil = s?.ok ? (s.withdraw_cooldown_until_ms as number | null) : null;
  const tierCaps = (lo?.ok ? lo.tier_limits : s?.ok ? s.tier_limits : null) as { per_tx_usd_micro: number; daily_usd_micro: number } | null | undefined;
  const lowered = !!(caps && tierCaps && (caps.per_tx_usd_micro < tierCaps.per_tx_usd_micro || caps.daily_usd_micro < tierCaps.daily_usd_micro));
  const perCap = caps ? caps.per_tx_usd_micro : CAPS[finish].perTx * 1e6;
  const dayCap = caps ? caps.daily_usd_micro : CAPS[finish].daily * 1e6;
  const spent = s?.ok ? s.spent_today_usd_micro : null;
  const dayPct = Math.min(100, ((spent ?? 0) / dayCap) * 100);
  const idn = held ? keyIdentity(held.token.token_id, held.tier) : null;
  // A read signed directly (a redirect wallet, no session) counts as much as a session read.
  const balances = balance.res?.output?.ok && (live || balance.via === "signature") ? (balance.res.output.balances as Bal[]) : d ? (d.balances as Bal[]) : null;
  const rows = balances ? assetRows(balances, prices) : null;
  const totalKind = totalOf(rows);
  const entries = (history.res?.output?.ok ? history.res.output.entries as HistEntry[] : null);
  const lockUntil = s?.ok ? (s.locked_until_ms as number | null | undefined) : null;
  const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
  const stateChip = !s?.ok ? null : lockUntil
    ? <StatusChip tone="warn" testid="state-badge">{t("vault.stLocked", { time: hhmm(lockUntil) })}</StatusChip>
    : coolUntil
      ? <StatusChip tone="error" testid="state-badge">{t("vault.stCooldown", { time: hhmm(coolUntil) })}</StatusChip>
      : <StatusChip tone="success" testid="state-badge">{t("vault.stOpen")}</StatusChip>;

  const clearOtherErrors = (keep: { clear: () => void }) => {
    for (const card of [account, balance, history, withdraw, limits, pnl, dash]) if (card !== keep) card.clear();
  };
  const clearAccount = account.clear;
  const clearBalance = balance.clear;
  const clearHistory = history.clear;
  // A redirect wallet returns with a withdrawal pending: reopen its sheet and show what it was for.
  useEffect(() => {
    const ctx = pending?.ctx;
    if (!ctx) return;
    clearAccount(); clearBalance(); clearHistory();
    if (ctx.op === "withdraw") { setDoneWithdraw({ amount: ctx.amount, to: ctx.to }); setWOpen(true); }
  }, [pending, clearAccount, clearBalance, clearHistory]);
  useEffect(() => { if (withdraw.res) sessionStorage.removeItem(OP_CTX); }, [withdraw.res]);
  useEffect(() => {
    if (!balances) return;
    let cancel = false;
    fetch("/api/prices").then((r) => (r.ok ? r.json() : null)).then((j) => { if (!cancel && j?.prices) setPrices((prev) => ({ ...prev, ...j.prices })); }).catch(() => {});
    return () => { cancel = true; };
  }, [balances]);
  // After a payout the balance is read again, with the session only.
  const readBalance = balance.run;
  useEffect(() => {
    const out = withdraw.res?.output;
    if (!out?.ok || out.op !== "exact_near_exit_v1" || !live) return;
    void readBalance({}, { quiet: true });
  }, [withdraw.res, readBalance, live]);

  async function unlock() {
    if (!held) return;
    setUnlocking(true); setUnlockErr(null);
    const r = await startSession(held.token.token_id);
    setUnlocking(false);
    if (!r.ok) setUnlockErr(r.code);
  }
  function doWithdraw() {
    if (!wUnits || !accountId || !wDest.ok || lock.locked) return;
    const ctx: OpResume = { op: "withdraw", amount: `${wAmt} ${ASSETS[wAsset].symbol}`, to: shortAccount(wAddr.trim()) };
    sessionStorage.setItem(OP_CTX, JSON.stringify(ctx));
    setDoneWithdraw(ctx);
    clearOtherErrors(withdraw);
    void withdraw.run(withdrawParams(accountId, wAsset, wUnits));
  }

  const totalText = totalKind.kind === "unread" ? t("vault.sealed") : totalKind.kind === "empty" ? formatUsdMicro(0) : totalKind.kind === "amounts" ? totalKind.text : formatUsdMicro(totalKind.micro);
  const left = live && session ? minutesLeft(session) : 0;
  const funded = !!balances && balances.some((b) => Number(b.amount ?? b.balance ?? 0) > 0);
  const swapped = logVerified === true && !!entries && settledOrders(entries) > 0;

  /** The one unlock for a card that needs a read: the same action the top-bar pill starts. */
  const unlockButton = (testid: string) => (
    <Button variant="secondary" size="sm" loading={unlocking} loadingLabel="Waiting for your wallet" testid={testid} onClick={() => void unlock()}>
      {unlocking ? "Waiting for your wallet…" : "Unlock to read"}
    </Button>
  );

  const limitsPanel = (
    <div className="vlt-stack">
      {s?.ok ? (
        <>
          <p className="vlt-cap" data-testid="limits-label">{lowered ? t("vault.limitsLabelOwn", { tier: t(`finish.${finish}`), tx: fmtUsd(tierCaps!.per_tx_usd_micro), day: fmtUsd(tierCaps!.daily_usd_micro) }) : t("vault.limitsLabel", { tier: t(`finish.${finish}`) })}</p>
          <Meter label={t("vault.perTx")} value={t("vault.capOnly", { cap: fmtUsd(perCap) })} testid="per-trade-meter" />
          <Meter label={t("vault.today")} value={t("vault.ofCap", { used: fmtUsd(spent ?? 0), cap: fmtUsd(dayCap) })} pct={dayPct} note={t("vault.utc", { time: utcReset })} />
        </>
      ) : live ? (
        dash.busy || !dash.res ? <p className="vlt-sub" data-testid="limits-reading"><Busy l="Reading your caps with your session" /></p>
          : <><p className="vlt-sub">Could not read your caps with the session.</p>{dash.res.error && <ErrorBox code={dash.res.error.code} />}<Button variant="secondary" size="sm" testid="dash-retry" onClick={() => void runDash({})}>Read caps and balance (session, no popup)</Button></>
      ) : <div className="vlt-actions">{unlockButton("limits-unlock")}</div>}
      {unlockErr && <ErrorBox code={unlockErr} />}
      {pendingLim && <p className="note-box" data-testid="limits-pending">{t("vault.limitsPending", { tx: fmtUsd(pendingLim.per_tx_usd_micro), day: fmtUsd(pendingLim.daily_usd_micro), time: new Date(pendingLim.effective_ms).toISOString().slice(0, 16).replace("T", " ") })}</p>}
      {s?.ok && held && (
        <form className="vlt-form" data-testid="limits-form" onSubmit={(e) => { e.preventDefault(); const a = usdMicro(limTx), b = usdMicro(limDay); if (!a || !b) return; clearOtherErrors(limits); void limits.run({ per_tx_usd_micro: a, daily_usd_micro: b }); }}>
          <p className="vlt-cap">{t("vault.myLimits")}</p>
          <p className="vlt-sub">{t("vault.myLimitsNote")}</p>
          <div className="vlt-pair">
            <div className="vlt-field">
              <label htmlFor="lim-tx">{t("vault.limPerTx")}</label>
              <div className="vlt-box" aria-invalid={!!limTx && !usdMicro(limTx)}><span className="u">$</span><input id="lim-tx" inputMode="decimal" placeholder={(perCap / 1e6).toString()} value={limTx} onChange={(e) => setLimTx(e.target.value)} data-testid="lim-tx" /></div>
            </div>
            <div className="vlt-field">
              <label htmlFor="lim-day">{t("vault.limDay")}</label>
              <div className="vlt-box" aria-invalid={!!limDay && !usdMicro(limDay)}><span className="u">$</span><input id="lim-day" inputMode="decimal" placeholder={(dayCap / 1e6).toString()} value={limDay} onChange={(e) => setLimDay(e.target.value)} data-testid="lim-day" /></div>
            </div>
          </div>
          {tierCaps && <p className="vlt-sub">{t("vault.limHelp", { tx: fmtUsd(tierCaps.per_tx_usd_micro), day: fmtUsd(tierCaps.daily_usd_micro) })}</p>}
          <Button type="submit" block loading={limits.busy} loadingLabel={limits.label} disabled={limits.busy || !usdMicro(limTx) || !usdMicro(limDay)} testid="limits-btn">
            {limits.busy ? limits.label : t("vault.setLimits")}
          </Button>
          {lo?.ok && <p className="vlt-sub" data-testid="limits-out">{t("vault.limitsNow", { tx: fmtUsd(lo.limits.per_tx_usd_micro), day: fmtUsd(lo.limits.daily_usd_micro) })}</p>}
          {limits.res?.error && <ErrorBox code={limits.res.error.code} retryAfter={limits.res.error.retry_after} />}
          {limits.res && <Attested r={limits.res} />}
        </form>
      )}
    </div>
  );

  const sessionPanel = (
    <div className="vlt-session" data-testid="vault-session">
      {live ? (
        <>
          <p className="vlt-sub"><b>Unlocked</b> · {left} min left. Reads and trades run under your caps with no popup. Withdrawals always ask your wallet.</p>
          <Button variant="secondary" size="sm" testid="session-revoke" onClick={() => void revokeSession()}>Lock now</Button>
        </>
      ) : (
        <>
          <p className="vlt-sub">Unlock for 30 minutes with one signature. Reads and trades then need no popup. Withdrawals still ask your wallet.</p>
          <div className="vlt-actions">{unlockButton("session-unlock")}</div>
          {unlockErr && <ErrorBox code={unlockErr} />}
        </>
      )}
    </div>
  );

  // The hero keeps the two big buttons of the mockup (Deposit, Withdraw). Unlock, or refresh once live, is one small pill on
  // the balance line: the same unlock and the same balance read as before (testid balance-btn).
  const balancePill = live ? (
    <button type="button" className="vlt-pill-btn" data-testid="balance-btn" aria-label="Refresh balance (session, no popup)" title="Refresh balance (session, no popup)" disabled={balance.busy} aria-busy={balance.busy || undefined} onClick={() => { clearOtherErrors(balance); void balance.run({}); }}>
      <RefreshGlyph />
      <span>{balance.busy ? balance.label : "Refresh"}</span>
    </button>
  ) : (
    <button type="button" className="vlt-pill-btn" data-testid="balance-btn" disabled={unlocking} aria-busy={unlocking || undefined} onClick={() => void unlock()}>
      {unlocking ? "Waiting for your wallet…" : "Unlock to read"}
    </button>
  );
  const heroActions = (
    <>
      <Button variant="banner" testid="open-deposit" onClick={() => setDepOpen(true)}>Deposit</Button>
      <Button variant="secondary" className="v7-on-vault" testid="open-withdraw" disabled={lock.locked} title={lock.locked ? LOCK_NOTE : undefined} onClick={() => setWOpen(true)}>Withdraw</Button>
    </>
  );
  const heroSub = (
    <>
      {!live
        ? t("vault.sealedBook")
        : balances
          ? <>{(balance.res?.output?.ok ? balance.via : dash.via) === "session" ? t("vault.balanceSession") : t("vault.balanceReal")}{totalKind.kind === "partial" && <span data-testid="unpriced"> {t("vault.unpriced", { amounts: totalKind.unpriced.join(" · ") })}</span>}</>
          : balance.res?.error ? "The balance read did not complete. Use Refresh to try again." : "Reading your balance with your session."}
      {" "}{balancePill}
    </>
  );

  const keyLabel = held ? keyState(held.token, held.tier, accountId) : "locked";

  const setupItems: SetupItem[] = [
    { id: "sign", title: "Sign in", done: true, note: "Signed in." },
    { id: "key", title: "Get key", done: !!held, note: held ? "Held on NEAR mainnet." : "Needs a key first." },
    { id: "unlock", title: "Unlock", done: live, note: live ? `${left} min left on this session.` : "One signature. 30 minutes." },
    { id: "fund", title: "Fund vault", done: funded, note: funded ? "Balance read from the vault." : live ? "A deposit is a transfer you approve in your wallet." : "Checked once you unlock." },
    { id: "swap", title: "First swap", done: swapped, note: swapped ? "Read from your signed activity." : "Checked from your activity once you unlock." },
  ];

  // Health is read passively (no paid probe), so before the first read it is neither live nor down. "Not probed" read as a fault to holders.
  const enclaveChip = online === true
    ? <StatusChip tone="success">Enclave live</StatusChip>
    : online === false
      ? <StatusChip tone="error">Not reachable</StatusChip>
      : <StatusChip tone="neutral" testid="enclave-checking">Checked when you read</StatusChip>;

  const proofAttestation = lastRes ? (lastVerified === true ? "verified" : lastVerified === false ? "not-verified" : "unread") : "unread";

  let body: ReactNode;
  if (online === false) {
    body = <div><OfflineState /><HowStrip /></div>;
  } else if (!accountId) {
    body = (
      <div>
        <EmptyState
          title={t("empty.vaultTitle")}
          body={t("empty.vaultBody")}
          action={(
            <div className="vlt-actions">
              <Button onClick={() => void connect()} testid="vault-connect">{t("nav.connect")}</Button>
              <Button variant="ghost" href="/demo" testid="vault-demo-link">No wallet? See the demo vault</Button>
            </div>
          )}
          testid="vault-empty"
        />
        <HowStrip active={1} />
      </div>
    );
  } else if (lookingUp) {
    body = (
      <Card as="section" labelledBy="vlt-loading-h" testid="key-loading" className="vlt-loading">
        <CardHeader title="Looking up your key" id="vlt-loading-h" icon="key" />
        <Skeleton lines={3} />
        {slowKey && <p className="vlt-sub" data-testid="key-slow">The NEAR RPC is slow right now. <button type="button" className="vlt-link" onClick={() => location.reload()}>Try again</button></p>}
      </Card>
    );
  } else if (failed) {
    body = (
      <EmptyState
        title="NEAR mainnet did not answer"
        body="Your key could not be read just now. The rest of the page still works."
        action={<Button variant="secondary" onClick={() => store.refresh()} testid="vault-key-retry">Try again</Button>}
        testid="vault-key-error"
      />
    );
  } else if (keyMiss) {
    body = (
      <div>
        <EmptyState
          title={t("vault.holderOnly")}
          body={t("vault.holderOnlyBody")}
          action={(
            <div className="vlt-actions">
              <Button href={dashHref("/mint")} testid="vault-mint">{t("vault.mintFirst")}</Button>
              <Button variant="ghost" href="/start" testid="vault-start">Start setup</Button>
            </div>
          )}
          testid="holder-only"
        />
        <HowStrip active={1} />
      </div>
    );
  } else {
    body = (
      <>
        <div className="vlt-hero-wrap" data-testid="balance-card">
          <VaultHero
            value={totalText}
            sealed={totalKind.kind === "unread"}
            sub={heroSub}
            actions={heroActions}
            chip={<span data-testid="vault-network">Mainnet</span>}
            valueTestId="vault-total"
            testid="vault-hero"
          />
          {lockUntil && <p className="vlt-notice" data-testid="lock-note">{t("vault.lockNote", { time: hhmm(lockUntil) })}</p>}
          {coolUntil ? <p className="vlt-notice" data-testid="lock-cooldown">{t("vault.cooldown", { time: hhmm(coolUntil) })}</p> : null}
          {unlockErr && <ErrorBox code={unlockErr} />}
          {balance.res?.error && <ErrorBox code={balance.res.error.code} retryAfter={balance.res.error.retry_after} />}
          <TeeProgress active={balance.busy} label="Reading your balance inside the enclave" testid="balance-progress" />
          {balance.res && <CallLine r={balance.res} />}
        </div>

        <div className="vlt-cols">
          <div className="vlt-col vlt-col-a">
            <Card as="section" labelledBy="vlt-assets-h" testid="assets-card" className="vlt-card" style={{ order: 1 }}>
              <CardHeader
                title="Your assets"
                id="vlt-assets-h"
                icon="layers"
                meta={balances ? t("vault.assets", { n: balances.length }) : <span className="vlt-total-sealed">Total (sealed) <Icon name="eye-off" size={15} /></span>}
              />
              {!balances && <p className="vlt-sub">{live ? "Reading your balance with your session." : "Unlock to read your assets."}</p>}
              {balances && balances.length === 0 && <p className="vlt-sub">{t("vault.empty")}</p>}
              {rows && rows.length > 0 && (
                <div className="vlt-assets" data-testid="asset-list">
                  {rows.map((b) => (
                    <div className="vlt-asset" key={b.key} data-token={b.symbol}>
                      <TokenMark assetId={b.known ? b.key : null} symbol={b.symbol} chain="near" size={24} />
                      <div className="vlt-asset-who"><b>{b.symbol}</b><small>{b.name ? `${b.name} · NEAR` : "NEAR"}</small></div>
                      <div className="vlt-asset-amt"><b>{b.amountLabel}</b>{b.usdMicro != null ? <small>{formatUsdMicro(b.usdMicro)}</small> : null}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="vlt-foot">
                <p className="vlt-sub">Trade USDC and wNEAR from this vault on the Swap page. The price check there needs no wallet.</p>
                <div className="vlt-actions"><Button href={dashHref("/swap")} variant="secondary" size="sm" testid="vault-swap-link">Open swap</Button></div>
              </div>
            </Card>

            <div className="vlt-proof-wrap" style={{ order: 3 }}>
              <ProofPanel
                headingId="vlt-proof-h"
                title="Proof of your calls"
                enclave={online === null ? "checking" : online ? "live" : "down"}
                contract={KEYS_CONTRACT}
                attestation={proofAttestation}
                lastCall={lastCall}
                compact
                verifyHref={lastCall ? dashHref(`/verify?call=${encodeURIComponent(lastCall)}`) : dashHref("/verify")}
                verifyTestId="vault-verify"
                testid="vault-proof"
              />
            </div>

            <Card as="section" labelledBy="vlt-activity-h" testid="activity-card" className="vlt-card" style={{ order: 5 }}>
              <CardHeader
                title="Recent vault activity"
                id="vlt-activity-h"
                icon="activity"
                action={<Link href={dashHref("/settle")} className="v7-card-link" data-testid="vault-activity-all">View all <Icon name="arrow-up-right" size={16} /></Link>}
              />
              {!history.res && <p className="vlt-sub">{live ? "Read your recent trades and withdrawals with your session." : "Unlock to read your recent trades and withdrawals."}</p>}
              {history.res?.output?.ok && logVerified === null && <p className="vlt-sub">{t("vault.checking")}</p>}
              {logVerified === false && <p className="vlt-sub" data-testid="vault-log-hidden">{logState === "previous" ? t("vault.logPrevious") : logState === "quote_unverified" ? t("vault.logQuoteUnverified") : t("vault.hiddenLog")}</p>}
              {logVerified === true && <StatusChip tone="success" testid="vault-verified">{t("vault.verified")}</StatusChip>}
              {logVerified === true && entries && entries.length === 0 && <p className="vlt-sub">{t("vault.empty")}</p>}
              {logVerified === true && entries && entries.length > 0 && (
                <div className="vlt-feed" data-testid="vault-feed">
                  {[...entries].reverse().slice(0, 8).map((e, i) => (
                    <ListRow
                      key={`${e.ts_ms ?? i}-${i}`}
                      iconName={ENTRY_ICON[e.kind ?? ""] ?? "activity"}
                      tone={ENTRY_TONE[e.kind ?? ""] ?? "neutral"}
                      title={`${kindLabel(e.kind)} · ${entryDetail(e)}`}
                      sub={ENTRY_SUB[e.kind ?? ""] ?? "Vault activity"}
                      meta={e.ts_ms ? new Date(e.ts_ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Time not recorded"}
                    />
                  ))}
                </div>
              )}
              {history.res?.error && <ErrorBox code={history.res.error.code} retryAfter={history.res.error.retry_after} />}
              {history.res && <CallLine r={history.res} />}
              <div className="vlt-foot">
                <p className="vlt-sub">{t("vault.pnlHelp")}</p>
                <div className="vlt-actions">
                  {live ? (
                    <Button variant="secondary" size="sm" loading={history.busy} loadingLabel={history.label} testid="history-btn" onClick={() => { clearOtherErrors(history); void history.run({}); }}>
                      {history.res ? "Refresh history" : "Read history"}
                    </Button>
                  ) : (!history.res && unlockButton("history-unlock"))}
                  {live ? (
                    <Button variant="secondary" size="sm" loading={pnl.busy} loadingLabel={pnl.label} testid="pnl-btn" onClick={() => { clearOtherErrors(pnl); void pnl.run({}); }}>{t("vault.pnlBtn")}</Button>
                  ) : unlockButton("pnl-unlock")}
                </div>
                {pnl.res?.output && (pnl.res.output as { statement?: string }).statement && (() => {
                  const o = pnl.res!.output as { statement: string; sig: string; minter: string };
                  const href = `/pnl#${encodeShare({ statement: o.statement, sig: o.sig, minter: o.minter, call_id: pnl.res!.call_id })}`;
                  return <p className="vlt-sub" data-testid="pnl-link"><Link href={href}>{t("vault.pnlOpen")}</Link></p>;
                })()}
                {pnl.res?.error && <ErrorBox code={pnl.res.error.code} retryAfter={pnl.res.error.retry_after} />}
              </div>
            </Card>
          </div>

          <div className="vlt-col vlt-col-b">
            <Card as="section" labelledBy="vlt-key-h" testid="key-card" className="vlt-card" style={{ order: 2 }}>
              <CardHeader
                title="Your key"
                id="vlt-key-h"
                icon="key"
                action={idn && held ? <StatusChip tone={keyLabel === "unlocked" ? "success" : "neutral"} testid="key-state">{keyLabel === "unlocked" ? "You hold it" : t(`gallery.${keyLabel}`)}</StatusChip> : undefined}
              />
              {idn && held ? (
                <>
                  <div className="vlt-key-row">
                    <div className="vlt-key-art">
                      <FoilCard finish={idn.finish}>
                        <KeyArt n={idn.art} alt={held.token.token_id} width={433} height={1080} />
                      </FoilCard>
                    </div>
                    <div className="vlt-key-meta">
                      <TierChip tier={t(`finish.${idn.finish}`)} />
                      <h3 title={held.token.token_id} data-testid="key-title">{t("gallery.key", { id: shortKeyId(held.token.token_id) })}</h3>
                      <p className="vlt-serial"><span className="v7-mono">{`#${serialOf(idn.seedHex).toUpperCase()}`}</span></p>
                      <p className="vlt-sub">Whoever holds this key operates the vault. The keys to the money never leave the enclave.</p>
                      <Link href={`/key?id=${encodeURIComponent(held.token.token_id)}`} className="v7-card-link vlt-key-link" aria-label="Open the key history">
                        Key history <Icon name="arrow-right" size={16} />
                      </Link>
                    </div>
                  </div>
                  <div className="vlt-key-foot">
                    <p className="vlt-acct">
                      <span>Account</span>
                      <span className="v7-mono" data-testid="vault-account">{accountId}</span>
                      <CopyButton value={accountId ?? ""} label="Copy account" />
                    </p>
                    {mintTx
                      ? <p className="vlt-note" data-testid="vault-mint-tx">Key minted · <TxLink hash={mintTx} /></p>
                      : <p className="vlt-note" data-testid="vault-key-link">Your key: <Link href={`/key?id=${encodeURIComponent(held.token.token_id)}`}>full history</Link> · <a href={acct(KEYS_CONTRACT)} target="_blank" rel="noreferrer">key contract on NearBlocks ↗</a></p>}
                  </div>
                  <details className="vlt-details">
                    <summary>Key traits and log</summary>
                    <dl className="vlt-kv" data-testid="vault-traits">
                      <dt>{t("field.head")}</dt><dd>{traitLabel(t, idn.head)}</dd>
                      <dt>{t("field.filigree")}</dt><dd>{traitLabel(t, idn.filigree)}</dd>
                      <dt>{t("field.enamel")}</dt><dd>{traitLabel(t, idn.enamel)}</dd>
                      <dt>{t("field.gem")}</dt><dd>{traitLabel(t, idn.gem)}</dd>
                      <dt>{t("field.cipher")}</dt><dd><Cipher bits={idn.bits} /></dd>
                      <dt>{t("proof.contract")}</dt><dd className="mono">{KEYS_CONTRACT}</dd>
                    </dl>
                    <KeyLog tokenId={held.token.token_id} />
                  </details>
                </>
              ) : (
                <p className="vlt-sub">{t("vault.nokey")} <Link href={dashHref("/mint")}>{t("vault.mintFirst")}</Link></p>
              )}
            </Card>

            <Card as="section" labelledBy="vlt-setup-h" testid="vault-setup-card" className="vlt-card" style={{ order: 4 }}>
              <SetupProgress items={setupItems} variant="horizontal" title="Setup progress" headingId="vlt-setup-h" doneText="Setup complete" testid="vault-setup-steps" />
              {held && !session && <p className="vlt-note" data-testid="vault-setup"><Link href="/start">New here? Finish setup in 5 steps →</Link></p>}
            </Card>

            <Card as="section" labelledBy="vlt-set-h" testid="settings-card" className="vlt-card" style={{ order: 6 }}>
              <CardHeader title="Vault settings" id="vlt-set-h" icon="shield" meta={stateChip} />
              <div className="vlt-set-list">
                <SettingRow
                  testid="settings-limits"
                  iconName="tag"
                  title="Your limits"
                  sub={s?.ok ? `Per trade ${fmtUsd(perCap)} · ${fmtUsd(dayCap)} a day` : live ? "Reading with your session." : "Unlock to read your caps."}
                  tail={pendingLim ? <StatusChip tone="warn" testid="pending-badge">{t("vault.stPending")}</StatusChip> : undefined}
                  open={panel === "limits"}
                  onClick={() => setPanel(panel === "limits" ? null : "limits")}
                />
                <SettingRow
                  testid="settings-session"
                  iconName={live ? "unlock" : "lock"}
                  title="Session"
                  sub={live ? `Unlocked · ${left} min left` : "Locked. One signature for 30 minutes."}
                  open={panel === "session"}
                  onClick={() => setPanel(panel === "session" ? null : "session")}
                />
                <SettingRow
                  testid="settings-withdraw"
                  iconName="arrow-up"
                  title="Withdraw to your NEAR account"
                  sub={lock.locked ? "Confirming an earlier deposit… no funds at risk." : "Only the current key holder receives withdrawals. Your wallet signs each one."}
                  onClick={() => { if (!lock.locked) setWOpen(true); }}
                />
                <SettingRow
                  testid="settings-fund-chain"
                  iconName="arrow-swap"
                  title="Fund from another chain"
                  sub="1Click (NEAR Intents) swaps a token you hold into your vault."
                  onClick={() => { setDepTab("chain"); setDepOpen(true); }}
                />
              </div>
              {panel && (
                <div id="vlt-set-panel" role="region" aria-label={panel === "limits" ? "Your limits" : "Session"} className="vlt-panel">
                  {panel === "limits" && limitsPanel}
                  {panel === "session" && sessionPanel}
                </div>
              )}
            </Card>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="page vlt" data-testid="vault-page">
      <PageHeader
        eyebrow="Vault"
        title={<>Your <em>confidential</em> vault</>}
        lead="Run, store, and withdraw assets inside your key's enclave."
        actions={enclaveChip}
        testid="vault-head"
      />

      {fo.order && !fo.terminal && <FundOrderBanner order={fo.order} status={fo.status} onOpen={() => setDepOpen(true)} />}

      {body}

      <Sheet open={depOpen} onClose={() => setDepOpen(false)} title="Deposit" testid="deposit-sheet">
        <Tabs id="dep" label="How to fund" value={depTab} onChange={(v) => setDepTab(v as DepTab)} testid="deposit-tabs" items={[
          { id: "direct", label: "Direct" },
          { id: "chain", label: "From another chain" },
        ]} />
        {fo.order && <FundOrderCard order={fo.order} status={fo.status} statusErr={fo.statusErr} terminal={fo.terminal} onClear={fo.clear} />}
        <p className="vlt-sub">{t("vault.fundLead")}</p>
        <div className="vlt-stack">
          <div className="vlt-field">
            <span className="vlt-label">{t("vault.asset")}</span>
            <TokenSelect label={t("vault.asset")} options={TOKEN_OPTIONS} value={ASSETS[fundAsset].id} onChange={(id) => setFundAsset(keyOfId(id))} testid="fund-asset" />
          </div>
          <AmountInput label={t("vault.amount")} value={fundAmt} onChange={setFundAmt} symbol={ASSETS[fundAsset].symbol} error={fundUnits ? null : t("vault.badAmount")} testid="fund-amt" />
          <div id="dep-panel" role="tabpanel" aria-labelledby={`dep-tab-${depTab}`} className="vlt-panel">
            {depTab === "direct" && (
              <>
                <Button block testid="fund-btn" loading={account.busy} loadingLabel={account.label} disabled={!fundUnits || account.busy} onClick={() => { if (fundUnits && accountId) { clearOtherErrors(account); setFundedFor(fundKey); void account.run(fundParams(fundAsset, fundUnits)); } }}>
                  {account.busy ? account.label : t("vault.fundBtn")}
                </Button>
                {account.res?.output?.ok && typeof account.res.output.deposit?.deposit_address === "string" && (
                  <div className="vlt-stack" data-testid="deposit">
                    <span className="vlt-label">{t("vault.deposit")}</span>
                    <DepositQr otherChain={false} evm={accountId && /^0x[0-9a-fA-F]{40}$/.test(accountId) ? accountId : null} address={String(account.res.output.deposit.deposit_address)} amount={`${fundAmt} ${ASSETS[fundAsset].symbol}`} />
                    {typeof account.res.output.deposit.hint === "string" && <p className="vlt-sub">{String(account.res.output.deposit.hint)}</p>}
                    {typeof account.res.output.deposit.expires_at === "string" && <p className="vlt-sub">{t("vault.expires", { time: String(account.res.output.deposit.expires_at) })}</p>}
                  </div>
                )}
                <div className="vlt-stack">
                  <span className="vlt-label">Vault address</span>
                  <div className="vlt-actions">
                    <Button variant="secondary" size="sm" testid="account-btn" onClick={() => { clearOtherErrors(account); void account.run({}); }}>{t("vault.open")}</Button>
                  </div>
                  {account.res?.output?.ok && account.res.output.confidential_id != null && (
                    <div className="vlt-field" data-testid="confidential-id">
                      <span className="vlt-label">{t("vault.sendTo")}</span>
                      <div className="vlt-box ro"><span className="v">{String(account.res.output.confidential_id)}</span>
                        <Button variant="secondary" size="sm" onClick={() => { const id = String(account.res?.output?.confidential_id ?? ""); void copyText(id).then(() => { setCopiedConf(true); window.setTimeout(() => setCopiedConf(false), 1600); }); }}>{copiedConf ? t("nav.copied") : t("nav.copy")}</Button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
            {depTab === "chain" && (
              <>
                <p className="vlt-sub">Pay from a chain you already hold. 1Click (NEAR Intents) swaps it into {ASSETS[fundAsset].symbol} and delivers it to your vault. Creating the quote moves no funds.</p>
                {fundedDeposit ? (
                  <FundFromChain recipient={fundedDeposit} dest={fundAsset === "wnear" ? "wnear" : "usdc"} destSymbol={ASSETS[fundAsset].symbol} units={fundUnits ?? ""} amount={fundAmt} evm={accountId && /^0x[0-9a-fA-F]{40}$/.test(accountId) ? accountId : null} order={fo.order} status={fo.status} statusErr={fo.statusErr} onSave={fo.save} />
                ) : live ? (
                  <div className="vlt-stack" data-testid="fac-target-step">
                    <p className="vlt-sub">Reads the vault&apos;s deposit address for {fundAmt} {ASSETS[fundAsset].symbol}. This is a signed read; no funds move.</p>
                    <Button block testid="fac-target" loading={account.busy} loadingLabel={account.label} disabled={!fundUnits || account.busy || !accountId} onClick={() => { if (fundUnits && accountId) { clearOtherErrors(account); setFundedFor(fundKey); void account.run(fundParams(fundAsset, fundUnits)); } }}>
                      Get vault deposit address
                    </Button>
                  </div>
                ) : (
                  <div className="vlt-stack" data-testid="fac-unlock-step">
                    <p className="vlt-sub">Unlock reads the vault&apos;s deposit address. It is the same unlock as the top bar; no funds move.</p>
                    <Button block testid="fac-unlock" loading={unlocking} loadingLabel="Unlocking" disabled={!held || unlocking} onClick={() => void unlock()}>Unlock to read</Button>
                    {unlockErr && <ErrorBox code={unlockErr} />}
                  </div>
                )}
              </>
            )}
          </div>
          {account.res?.error && <ErrorBox code={account.res.error.code} retryAfter={account.res.error.retry_after} />}
          {account.res && <Attested r={account.res} />}
        </div>
      </Sheet>

      <Sheet open={wOpen} onClose={() => { setWOpen(false); if (!withdraw.busy) withdraw.reset(); }} title="Withdraw" testid="withdraw-sheet">
        {!withdraw.busy && !withdraw.res && (
<>
<p className="vlt-sub">{t("vault.withdrawLead", { account: accountId ?? "" })}</p>
        <div className="vlt-stack">
          <div className="vlt-field">
            <span className="vlt-label">{t("vault.asset")}</span>
            <TokenSelect label={t("vault.asset")} options={TOKEN_OPTIONS} value={ASSETS[wAsset].id} onChange={(id) => setWAsset(keyOfId(id))} testid="w-asset" />
          </div>
          <AmountInput label={t("vault.amount")} value={wAmt} onChange={setWAmt} symbol={ASSETS[wAsset].symbol} error={wUnits ? null : t("vault.badAmount")} testid="w-amt" />
          <div className="vlt-field" data-testid="w-chain-field">
            <span className="vlt-label">Chain</span>
            <div className="vlt-box ro" data-testid="w-chain"><span className="v">NEAR</span></div>
            <p className="vlt-sub">Withdrawals go only to the current key holder on NEAR.</p>
          </div>
          <div className="vlt-field">
            <span className="vlt-label">{t("vault.dest")}</span>
            <div className="vlt-box ro" data-testid="w-dest"><span className="v">{wAddr}</span></div>
            <p className="vlt-sub" id="w-dest-note">Your signed-in NEAR account. The worker verifies you still hold the key.</p>
          </div>
          {coolUntil ? <p className="note-box" data-testid="cooldown-note">{t("vault.cooldown", { time: hhmm(coolUntil) })}</p> : null}
          {lock.locked && <ValueRecovery testid="withdraw-recovery" />}
          <Button block testid="withdraw-btn" loading={withdraw.busy || lock.locked} loadingLabel={lock.locked ? LOCK_LABEL : withdraw.label} disabled={!wUnits || !wDest.ok || withdraw.busy || lock.locked} onClick={doWithdraw}>
            {lock.locked ? LOCK_LABEL : t("vault.withdrawBtn")}
          </Button>
        </div>
</>
)}
        {withdraw.busy && <InCardProgress title="Withdrawing…" line={withdraw.label || "Sending your payout"} fraction={withdraw.stage === "settling" ? 0.75 : 0.4} testid="withdraw-pending" />}
        {!withdraw.busy && withdraw.res?.output?.ok && withdraw.res.output.op === "exact_near_exit_v1" && doneWithdraw && (
          <InCardSuccess testid="withdraw-out" amount={withdrawSummary(doneWithdraw.amount, doneWithdraw.to)} title="Settled"
            link={withdraw.res.output.tx_hash ? { href: tx(String(withdraw.res.output.tx_hash)), label: `View ${String(withdraw.res.output.tx_hash).slice(0, 8)}… on NearBlocks` } : { href: acct(accountId || ""), label: "Open your account on NearBlocks" }}
            actions={<><Button size="sm" onClick={() => { withdraw.reset(); }} testid="withdraw-again">Withdraw again</Button><Button size="sm" variant="secondary" href={dashHref("/settle")}>View in Activity</Button></>}>
            <Details>
              <p className="vlt-sub" data-testid="withdraw-receipt">To {String(withdraw.res.output.to ?? doneWithdraw.to)} · amount {String(withdraw.res.output.amount ?? doneWithdraw.amount)}{withdraw.res.output.fee ? ` · fee ${String(withdraw.res.output.fee)}` : ""}</p>
              {!withdraw.res.output.tx_hash && <p className="vlt-sub" data-testid="withdraw-settling">The payout is sent by the custody wallet and shows on your account page within about a minute.</p>}
              {isImplicitAccount(accountId || "") && <p className="vlt-sub">{t("vault.storageNote")}</p>}
              {withdraw.res.output.request_id && <p className="mono vlt-small">{t("vault.request")} {String(withdraw.res.output.request_id)}</p>}
              <Attested r={withdraw.res} />
            </Details>
          </InCardSuccess>
        )}
        {!withdraw.busy && withdraw.res?.error && (isNotSent(withdraw.res.error.code)
          ? <OpNotSent code={withdraw.res.error.code} message={withdraw.res.error.message} noun="withdrawal" knownOpId={lock.rows[0]?.value_op_id ?? null} testid="withdraw-not-sent" />
          : <InCardFailure testid="withdraw-failed" reason={errorText(withdraw.res.error.code, { s: withdraw.res.error.retry_after ?? 0, cap: capFrom(withdraw.res.error.message) })[0]} action={{ label: "Back to withdraw", onClick: () => withdraw.reset(), testid: "withdraw-back" }}>
              <Details><p className="vlt-sub">Reference: <code>{withdraw.res.error.code}</code></p></Details>
            </InCardFailure>)}
      </Sheet>
    </div>
  );
}

