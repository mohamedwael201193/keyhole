"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Attested, ErrorBox, OfflineState, capFrom } from "@/components/Result";
import { TxLink } from "@/components/TxLink";
import { loadMintTx } from "@/lib/mintTx";
import { HowStrip } from "@/components/HowStrip";
import { EmptyState } from "@/components/EmptyState";
import { Cipher } from "@/components/Cipher";
import { KeyArt } from "@/components/Art";
import { Guilloche, Hallmark } from "@/components/Engraving";
import { FoilCard } from "@/components/FoilCard";
import { TokenIcon } from "@/components/TokenIcon";
import { useI18n } from "@/lib/i18n";
import { useWallet, OP_CTX, type OpResume } from "@/lib/wallet";
import { useSigned } from "@/lib/useSigned";
import { encodeShare } from "@/lib/pnl";
import { useHealth } from "@/lib/useHealth";
import { heldFrom, useKeyStore } from "@/lib/keyStore";
import { useLogVerified } from "@/lib/useLogVerified";
import { ASSETS, toBaseUnits, type AssetKey } from "@/lib/assets";
import { fundParams, withdrawParams } from "@/lib/trade";
import { keyState, shortAccount, shortKeyId } from "@/lib/near";
import { acct, KEYS_CONTRACT, WORKER_WASM_SHA256 } from "@/lib/config";
import { minutesLeft } from "@/lib/session";
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
import { AmountInput, Button, Busy, Card, Sheet, Spinner, Tabs, TokenSelect, type TokenOption } from "@/components/ui";
import { TxStatus } from "@/components/ui/tx-status";
import "./vault.css";

type Bal = { token?: string; symbol?: string; amount?: string; balance?: string; usd?: number; usd_micro?: number };
type Hist = { ts_ms?: number; kind?: string; token_in?: string; token_out?: string; amount_in?: string; amount_out?: string; usd_in_micro?: number; token?: string; amount?: string; chain?: string; status?: string };
type Tab = "limits" | "session" | "lock";
type DepTab = "direct" | "chain";
type DoneWithdraw = { amount: string; to: string };

const ASSET_KEYS = Object.keys(ASSETS) as AssetKey[];
const keyOfId = (id: string): AssetKey => ASSET_KEYS.find((k) => ASSETS[k].id === id) ?? "usdc";
/** The vault holds and withdraws the two assets the trade supports. */
const TOKEN_OPTIONS: TokenOption[] = ASSET_KEYS.map((k) => ({ id: ASSETS[k].id, symbol: ASSETS[k].symbol, name: ASSETS[k].name, assetId: ASSETS[k].id, chain: "near" }));

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

/**
 * The vault. Keys come from the shared key store (no lookup of its own). The vault is open only while the 30-minute session
 * for the holder's key is live: then the balance, the caps and the lock state read by themselves, once per session. With no
 * live session the page shows one "Unlock to read" action, which is the same unlock the top-bar pill uses. Deposit and
 * withdraw keep their own sheets; a withdrawal always asks the wallet for a fresh signature.
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
  const withdraw = useSigned("withdraw");
  const limits = useSigned("limits");
  const pnl = useSigned("pnl");
  const dash = useSigned("dashboard");
  const logVerified = useLogVerified(history.res);

  const [tab, setTab] = useState<Tab>("limits");
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
  const [copied, setCopied] = useState(false);
  const [copiedConf, setCopiedConf] = useState(false);
  const [slowKey, setSlowKey] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockErr, setUnlockErr] = useState<string | null>(null);
  const fundUnits = toBaseUnits(fundAmt, ASSETS[fundAsset].decimals);
  // The vault's deposit target for the amount on screen. A target read for another asset or amount is stale and is not used.
  const fundKey = `${fundAsset}:${fundUnits ?? ""}`;
  const fundedDeposit = account.res?.output?.ok && fundedFor === fundKey && typeof account.res.output.deposit?.deposit_address === "string" ? String(account.res.output.deposit.deposit_address) : null;
  const wUnits = toBaseUnits(wAmt, ASSETS[wAsset].decimals);
  const utcReset = (() => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); })();

  const heldId = held?.token.token_id ?? null;
  // The saved "from another chain" order for this key: shown on the page banner and at the top of the Deposit sheet.
  const fo = useFundOrder(accountId, heldId);
  // Live: a session for this account and this key that has not run out.
  const live = !!(session && heldId && session.account === accountId && session.token_id === heldId && minutesLeft(session) > 0);
  const sessionToken = live && session ? session.token : "";

  // One automatic read per session: the balance and the dashboard (caps, lock state). Guarded by the session token, so it
  // cannot loop; a failure shows a retry and never re-runs by itself.
  const runBalance = balance.run;
  const runDash = dash.run;
  const autoFor = useRef("");
  useEffect(() => {
    if (!sessionToken) { autoFor.current = ""; return; }
    if (autoFor.current === sessionToken) return;
    autoFor.current = sessionToken;
    void runBalance({}, { quiet: true });
    void runDash({}, { quiet: true });
  }, [sessionToken, runBalance, runDash]);

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
  const entries = (history.res?.output?.ok ? history.res.output.entries as Hist[] : null);
  const lockUntil = s?.ok ? (s.locked_until_ms as number | null | undefined) : null;
  const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
  const stateBadge = !s?.ok ? null : lockUntil
    ? <span className="vlt-state lock" data-testid="state-badge" data-state="locked"><i />{t("vault.stLocked", { time: hhmm(lockUntil) })}</span>
    : coolUntil
      ? <span className="vlt-state cool" data-testid="state-badge" data-state="cooldown"><i />{t("vault.stCooldown", { time: hhmm(coolUntil) })}</span>
      : <span className="vlt-state ok" data-testid="state-badge" data-state="open"><i />{t("vault.stOpen")}</span>;

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
    fetch("/api/prices").then((r) => (r.ok ? r.json() : null)).then((j) => { if (!cancel && j?.prices) setPrices(j.prices); }).catch(() => {});
    return () => { cancel = true; };
  }, [balances]);
  // After a payout the balance is read again, with the session only.
  const readBalance = balance.run;
  useEffect(() => {
    const out = withdraw.res?.output;
    if (!out?.ok || out.op !== "withdraw" || !live) return;
    void readBalance({}, { quiet: true });
  }, [withdraw.res, readBalance, live]);

  async function unlock() {
    if (!held) return;
    setUnlocking(true); setUnlockErr(null);
    const r = await startSession(held.token.token_id);
    setUnlocking(false);
    if (!r.ok) setUnlockErr(r.code);
  }
  function copyAccount() {
    if (!accountId) return;
    void copyText(accountId).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); });
  }
  function doWithdraw() {
    if (!wUnits || !accountId) return;
    const ctx: OpResume = { op: "withdraw", amount: `${wAmt} ${ASSETS[wAsset].symbol}`, to: shortAccount(accountId) };
    sessionStorage.setItem(OP_CTX, JSON.stringify(ctx));
    setDoneWithdraw(ctx);
    clearOtherErrors(withdraw);
    void withdraw.run(withdrawParams(accountId, wAsset, wUnits));
  }

  const totalText = totalKind.kind === "unread" ? t("vault.sealed") : totalKind.kind === "empty" ? formatUsdMicro(0) : totalKind.kind === "amounts" ? totalKind.text : formatUsdMicro(totalKind.micro);
  const left = live && session ? minutesLeft(session) : 0;

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

  const lockPanel = (
    <div className="vlt-stack" data-testid="lock-panel">
      {!s?.ok ? <p className="vlt-sub">Unlock to read the lock state.</p>
        : lockUntil ? <p className="note-box" data-testid="lock-note">{t("vault.lockNote", { time: hhmm(lockUntil) })}</p>
        : <p className="vlt-sub">No time lock is set on this vault.</p>}
      {coolUntil ? <p className="vlt-sub" data-testid="lock-cooldown">{t("vault.cooldown", { time: hhmm(coolUntil) })}</p> : null}
    </div>
  );

  return (
    <div className="page vlt" data-testid="vault-page">
      <header className="vlt-head">
        <div>
          <p className="eb">{accountId ? t("vault.eyebrow", { account: shortAccount(accountId) }) : t("vault.eyebrowOff")}</p>
          <h1 className="vlt-title">{t("vault.title")}</h1>
          {accountId && (
            <p className="vlt-acct">
              <span className="id" data-testid="vault-account">{accountId}</span>
              <button type="button" className="vlt-link" onClick={copyAccount}>{copied ? t("nav.copied") : t("nav.copy")}</button>
            </p>
          )}
        </div>
        <div className="vlt-chips">
          {stateBadge}
          {online === true && <span className="vlt-chip"><i />{t("vault.live", { hash: WORKER_WASM_SHA256[0].slice(0, 8) })}</span>}
          {online === null && <span className="vlt-chip wait" data-testid="enclave-checking"><i />{t("vault.checking")}</span>}
        </div>
      </header>

      {fo.order && !fo.terminal && <FundOrderBanner order={fo.order} status={fo.status} onOpen={() => setDepOpen(true)} />}

      {online === false ? (
        <div><OfflineState /><HowStrip /></div>
      ) : !accountId ? (
        <div>
          <EmptyState title={t("empty.vaultTitle")} body={t("empty.vaultBody")} testid="vault-empty">
            <Button onClick={() => void connect()} testid="vault-connect">{t("nav.connect")}</Button>
            <Button variant="secondary" href="/mint">{t("mint.title")}</Button>
            <Button variant="secondary" href="/demo" testid="vault-demo-link">No wallet? See the demo vault</Button>
          </EmptyState>
          <HowStrip active={1} />
        </div>
      ) : lookingUp ? (
        <p className="note" data-testid="key-loading"><Spinner label="Looking up your key" /> {t("vault.keyLoading")}{slowKey && <span data-testid="key-slow"> The NEAR RPC is slow right now. <button type="button" className="vlt-link" onClick={() => location.reload()}>Try again</button></span>}</p>
      ) : failed ? (
        <EmptyState title="NEAR mainnet did not answer" body="Your key could not be read just now. The rest of the page still works." testid="vault-key-error">
          <Button variant="secondary" onClick={() => store.refresh()} testid="vault-key-retry">Try again</Button>
        </EmptyState>
      ) : keyMiss ? (
        <div>
          <EmptyState title={t("vault.holderOnly")} body={t("vault.holderOnlyBody")} testid="holder-only">
            <Button href="/start" testid="vault-start">Start setup</Button>
            <Button variant="secondary" href="/mint">{t("vault.mintFirst")}</Button>
          </EmptyState>
          <HowStrip active={1} />
        </div>
      ) : (
        <>
          {held && !session && <p className="vlt-note" data-testid="vault-setup"><Link href="/start">New here? Finish setup in 5 steps →</Link></p>}
          {held && mintTx && <p className="vlt-note" data-testid="vault-mint-tx">Key minted · <TxLink hash={mintTx} /></p>}
          {held && !mintTx && <p className="vlt-note" data-testid="vault-key-link">Your key: <Link href={`/key?id=${encodeURIComponent(held.token.token_id)}`}>full history</Link> · <a href={acct(KEYS_CONTRACT)} target="_blank" rel="noreferrer">key contract on NearBlocks ↗</a></p>}

          <Card tone="banner" as="section" className="vlt-hero" testid="balance-card" aria-labelledby="vlt-hero-cap">
            <div className="vlt-hero-top">
              <p id="vlt-hero-cap" className="vlt-cap">Vault balance</p>
              <span className="vlt-net" data-testid="vault-network"><i aria-hidden="true" />Mainnet</span>
            </div>
            <p className="vlt-total" data-testid="vault-total">{totalText}</p>
            {totalKind.kind === "partial" && <p className="vlt-src" data-testid="unpriced">{t("vault.unpriced", { amounts: totalKind.unpriced.join(" · ") })}</p>}
            <div className="vlt-status">
              <span className="vlt-src">{balances ? ((balance.res?.output?.ok ? balance.via : dash.via) === "session" ? t("vault.balanceSession") : t("vault.balanceReal")) : t("vault.sealedBook")}</span>
              {live ? (
                <Button variant="secondary" size="sm" testid="balance-btn" loading={balance.busy} loadingLabel={balance.label} onClick={() => { clearOtherErrors(balance); void balance.run({}); }}>
                  {balance.busy ? balance.label : "Refresh balance (session, no popup)"}
                </Button>
              ) : (
                <Button variant="secondary" size="sm" testid="balance-btn" loading={unlocking} loadingLabel="Waiting for your wallet" onClick={() => void unlock()}>
                  {unlocking ? "Waiting for your wallet…" : "Unlock to read"}
                </Button>
              )}
            </div>
            {unlockErr && <ErrorBox code={unlockErr} />}
            <div className="vlt-hero-actions">
              <Button variant="banner" testid="open-deposit" onClick={() => setDepOpen(true)}>Deposit</Button>
              <Button variant="secondary" testid="open-withdraw" onClick={() => setWOpen(true)}>Withdraw</Button>
            </div>
            {balance.res?.error && <ErrorBox code={balance.res.error.code} retryAfter={balance.res.error.retry_after} />}
            {balance.res && <Attested r={balance.res} />}
          </Card>

          <div className="vlt-grid">
            <div className="vlt-main">
              <Card as="section" className="vlt-card" testid="assets-card" aria-labelledby="vlt-assets-h">
                <div className="vlt-cardhead">
                  <h2 id="vlt-assets-h">Assets</h2>
                  {balances && <span className="vlt-cap">{t("vault.assets", { n: balances.length })}</span>}
                </div>
                {!balances && <p className="vlt-sub">{live ? "Reading your balance with your session." : "Unlock to read your assets."}</p>}
                {balances && balances.length === 0 && <p className="vlt-sub">{t("vault.empty")}</p>}
                {rows && rows.length > 0 && (
                  <div className="vlt-assets" data-testid="asset-list">
                    {rows.map((b) => (
                      <div className="vlt-asset" key={b.key} data-token={b.symbol}>
                        <TokenIcon assetId={b.known ? b.key : null} symbol={b.symbol} size={24} />
                        <div className="vlt-asset-who"><b>{b.symbol}</b><small>{b.name ? `${b.name} · NEAR` : "NEAR"}</small></div>
                        <div className="vlt-asset-amt"><b>{b.amountLabel}</b>{b.usdMicro != null ? <small>{formatUsdMicro(b.usdMicro)}</small> : null}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card as="section" className="vlt-card" testid="activity-card" aria-labelledby="vlt-activity-h">
                <div className="vlt-cardhead">
                  <h2 id="vlt-activity-h">{t("vault.activity")}</h2>
                  {live ? (
                    <Button variant="secondary" size="sm" loading={history.busy} loadingLabel={history.label} onClick={() => { clearOtherErrors(history); void history.run({}); }}>{t("vault.history")}</Button>
                  ) : !history.res && unlockButton("history-unlock")}
                </div>
                {!history.res && <p className="vlt-sub">{live ? "Read your recent trades and withdrawals with your session." : "Unlock to read your recent trades and withdrawals."}</p>}
                {history.res?.output?.ok && logVerified === null && <p className="vlt-sub">{t("vault.checking")}</p>}
                {logVerified === false && <p className="vlt-sub" data-testid="vault-log-hidden">{t("vault.hiddenLog")}</p>}
                {logVerified === true && <p><span className="vlt-state ok" data-testid="vault-verified"><i />{t("vault.verified")}</span></p>}
                {logVerified === true && entries && entries.length === 0 && <p className="vlt-sub">{t("vault.empty")}</p>}
                {logVerified === true && entries && entries.length > 0 && (
                  <ul className="vlt-log">
                    {[...entries].reverse().slice(0, 8).map((e, i) => (
                      <li key={i}>
                        <span className="op">{e.kind || "—"}</span>
                        <span>{e.token_in ? `${e.amount_in ?? ""} ${e.token_in} → ${e.amount_out ?? ""} ${e.token_out ?? ""}` : `${e.amount ?? ""} ${e.token ?? ""}`}</span>
                        <small>{e.ts_ms ? new Date(e.ts_ms).toLocaleString() : ""}</small>
                      </li>
                    ))}
                  </ul>
                )}
                {history.res?.error && <ErrorBox code={history.res.error.code} retryAfter={history.res.error.retry_after} />}
                {history.res && <Attested r={history.res} />}
                <p className="vlt-sub">{t("vault.pnlHelp")}</p>
                <div className="vlt-actions">
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
              </Card>
            </div>

            <div className="vlt-side">
              <Card as="section" className="vlt-card" testid="key-card" aria-labelledby="vlt-key-h">
                <div className="vlt-cardhead">
                  <h2 id="vlt-key-h">Your key</h2>
                  {/* "Unlocked" here meant "you hold it", which read as the session state next to the top-bar pill. */}
                  {idn && held ? <span className="vlt-state ok" data-state={keyState(held.token, held.tier, accountId)}><i />{keyState(held.token, held.tier, accountId) === "unlocked" ? "You hold it" : t(`gallery.${keyState(held.token, held.tier, accountId)}`)}</span> : null}
                </div>
                {idn && held ? (
                  <>
                    <div className="vlt-key">
                      <FoilCard finish={idn.finish}>
                        <div className="top">
                          <span className="tier">{t(`finish.${idn.finish}`)}</span>
                          <span className="oo">{t("land.oneOfOne")}</span>
                        </div>
                        <div className="art">
                          <Guilloche seed={idn.seedHex} />
                          <KeyArt n={idn.art} alt={held.token.token_id} width={433} height={1080} />
                        </div>
                        <Hallmark bits={idn.bits} serial={serialOf(idn.seedHex)} />
                        <h3 title={held.token.token_id} data-testid="key-title">{t("gallery.key", { id: shortKeyId(held.token.token_id) })}</h3>
                      </FoilCard>
                      <dl className="vlt-kv" data-testid="vault-traits">
                        <dt>{t("field.head")}</dt><dd>{traitLabel(t, idn.head)}</dd>
                        <dt>{t("field.filigree")}</dt><dd>{traitLabel(t, idn.filigree)}</dd>
                        <dt>{t("field.enamel")}</dt><dd>{traitLabel(t, idn.enamel)}</dd>
                        <dt>{t("field.gem")}</dt><dd>{traitLabel(t, idn.gem)}</dd>
                        <dt>{t("field.cipher")}</dt><dd><Cipher bits={idn.bits} /></dd>
                        <dt>{t("proof.contract")}</dt><dd className="mono">{KEYS_CONTRACT}</dd>
                      </dl>
                    </div>
                    <KeyLog tokenId={held.token.token_id} />
                  </>
                ) : (
                  <p className="vlt-sub">{t("vault.nokey")} <Link href="/mint">{t("vault.mintFirst")}</Link></p>
                )}
              </Card>

              <Card as="section" className="vlt-card" testid="settings-card" aria-labelledby="vlt-set-h">
                <div className="vlt-cardhead">
                  <h2 id="vlt-set-h">Settings</h2>
                  {pendingLim ? <span className="vlt-state pend" data-testid="pending-badge"><i />{t("vault.stPending")}</span> : null}
                </div>
                <Tabs id="vset" label="Vault settings" value={tab} onChange={(v) => setTab(v as Tab)} testid="settings-tabs" items={[
                  { id: "limits", label: "Limits" },
                  { id: "session", label: "Session" },
                  { id: "lock", label: "Lock" },
                ]} />
                <div id="vset-panel" role="tabpanel" aria-labelledby={`vset-tab-${tab}`} className="vlt-panel">
                  {tab === "limits" && limitsPanel}
                  {tab === "session" && sessionPanel}
                  {tab === "lock" && lockPanel}
                </div>
              </Card>

              <Card as="section" className="vlt-card" testid="vault-swap-card" aria-labelledby="vlt-swap-h">
                <div className="vlt-cardhead"><h2 id="vlt-swap-h">Swap</h2></div>
                <p className="vlt-sub">Trade USDC and wNEAR from this vault on the Swap page. The price check there needs no wallet.</p>
                <div className="vlt-actions">
                  <Button href="/swap" variant="secondary" testid="vault-swap-link">Open swap</Button>
                </div>
              </Card>
            </div>
          </div>

          <HowStrip active={2} />
        </>
      )}

      <Sheet open={depOpen} onClose={() => setDepOpen(false)} title="Deposit" testid="deposit-sheet">
        {fo.order && <FundOrderCard order={fo.order} status={fo.status} statusErr={fo.statusErr} terminal={fo.terminal} onClear={fo.clear} />}
        <p className="vlt-sub">{t("vault.fundLead")}</p>
        <div className="vlt-stack">
          <div className="vlt-field">
            <span className="vlt-label">{t("vault.asset")}</span>
            <TokenSelect label={t("vault.asset")} options={TOKEN_OPTIONS} value={ASSETS[fundAsset].id} onChange={(id) => setFundAsset(keyOfId(id))} testid="fund-asset" />
          </div>
          <AmountInput label={t("vault.amount")} value={fundAmt} onChange={setFundAmt} symbol={ASSETS[fundAsset].symbol} error={fundUnits ? null : t("vault.badAmount")} testid="fund-amt" />
          <Tabs id="dep" label="How to fund" value={depTab} onChange={(v) => setDepTab(v as DepTab)} testid="deposit-tabs" items={[
            { id: "direct", label: "Direct" },
            { id: "chain", label: "From another chain" },
          ]} />
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

      <Sheet open={wOpen} onClose={() => setWOpen(false)} title="Withdraw" testid="withdraw-sheet">
        <p className="vlt-sub">{t("vault.withdrawLead", { account: accountId ?? "" })}</p>
        <div className="vlt-stack">
          <div className="vlt-field">
            <span className="vlt-label">{t("vault.asset")}</span>
            <TokenSelect label={t("vault.asset")} options={TOKEN_OPTIONS} value={ASSETS[wAsset].id} onChange={(id) => setWAsset(keyOfId(id))} testid="w-asset" />
          </div>
          <AmountInput label={t("vault.amount")} value={wAmt} onChange={setWAmt} symbol={ASSETS[wAsset].symbol} error={wUnits ? null : t("vault.badAmount")} testid="w-amt" />
          <div className="vlt-field">
            <span className="vlt-label">{t("vault.dest")}</span>
            <div className="vlt-box ro"><span className="v">{accountId}</span></div>
            <p className="vlt-sub">{t("vault.destHelp")}</p>
          </div>
          {coolUntil ? <p className="note-box" data-testid="cooldown-note">{t("vault.cooldown", { time: hhmm(coolUntil) })}</p> : null}
          <Button block testid="withdraw-btn" loading={withdraw.busy} loadingLabel={withdraw.label} disabled={!wUnits || withdraw.busy} onClick={doWithdraw}>
            {withdraw.busy ? withdraw.label : t("vault.withdrawBtn")}
          </Button>
          {withdraw.busy && <TxStatus state="pending" title="Waiting for the payout" testid="withdraw-pending" />}
          {withdraw.res?.output?.ok && withdraw.res.output.op === "withdraw" && doneWithdraw && (
            <div className="vlt-stack" data-testid="withdraw-out">
              <TxStatus state="confirmed" title={withdrawSummary(doneWithdraw.amount, doneWithdraw.to)} hash={withdraw.res.output.tx_hash ? String(withdraw.res.output.tx_hash) : undefined} callId={withdraw.res.call_id ?? undefined}>
                <p className="vlt-sub">{String(withdraw.res.output.status ?? "")}</p>
                {withdraw.res.output.request_id && <p className="mono vlt-small">{t("vault.request")} {String(withdraw.res.output.request_id)}</p>}
                <p className="mono vlt-small" data-testid="withdraw-receipt">{t("vault.to")}: {String(withdraw.res.output.to ?? doneWithdraw.to)} · {t("vault.amount")}: {String(withdraw.res.output.amount ?? doneWithdraw.amount)}{withdraw.res.output.fee ? <> · {t("vault.fee")}: {String(withdraw.res.output.fee)}</> : null}</p>
                {!withdraw.res.output.tx_hash && <p className="vlt-sub" data-testid="withdraw-settling">Settling: the payout transaction is sent by the custody wallet and shows on your account&apos;s explorer page within about a minute. <a href={acct(accountId || "")} target="_blank" rel="noreferrer">Open explorer ↗</a></p>}
                {isImplicitAccount(accountId || "") && <p className="vlt-sub">{t("vault.storageNote")}</p>}
              </TxStatus>
            </div>
          )}
          {withdraw.res?.error && <ErrorBox code={withdraw.res.error.code} retryAfter={withdraw.res.error.retry_after} vars={{ cap: capFrom(withdraw.res.error.message) }} />}
          {withdraw.res && !(withdraw.res.output?.ok && withdraw.res.output.op === "withdraw" && doneWithdraw) && <Attested r={withdraw.res} />}
        </div>
      </Sheet>
    </div>
  );
}
