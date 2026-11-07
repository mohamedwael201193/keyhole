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
import { useHeldKey } from "@/lib/useHeldKey";
import { useLogVerified } from "@/lib/useLogVerified";
import { ASSETS, toBaseUnits, type AssetKey } from "@/lib/assets";
import { fundParams, withdrawParams } from "@/lib/trade";
import { keyState, shortAccount, shortKeyId } from "@/lib/near";
import { acct, KEYS_CONTRACT, WORKER_WASM_SHA256 } from "@/lib/config";
import { SessionCard } from "@/components/SessionCard";
import { DepositQr } from "@/components/DepositQr";
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

export function VaultView({ initialOnline, initialPrices = {} }: { initialOnline: boolean; initialPrices?: PriceBook }) {
  const { t, fmtUsd } = useI18n();
  const { accountId, connect, pending, session } = useWallet();
  const online = useHealth(initialOnline);
  const { held, keyMiss, lookingUp } = useHeldKey(accountId);
  const status = useSigned("status");
  const account = useSigned("account");
  const balance = useSigned("balance");
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
  const [wAsset, setWAsset] = useState<AssetKey>("usdc");
  const [wAmt, setWAmt] = useState("0.05");
  const [doneWithdraw, setDoneWithdraw] = useState<DoneWithdraw | null>(null);
  const [prices, setPrices] = useState(initialPrices);
  const [mintTx, setMintTx] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedConf, setCopiedConf] = useState(false);
  const [slowKey, setSlowKey] = useState(false);
  const fundUnits = toBaseUnits(fundAmt, ASSETS[fundAsset].decimals);
  const wUnits = toBaseUnits(wAmt, ASSETS[wAsset].decimals);
  const utcReset = (() => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); })();
  const sessionLive = !!(session && held && session.token_id === held.token.token_id);

  // With a live session one dashboard read fills limits, balance and state, with no wallet popup.
  const runDash = dash.run;
  const dashFor = useRef("");
  useEffect(() => {
    if (!session || !held || session.token_id !== held.token.token_id) return;
    if (dashFor.current === session.token) return;
    dashFor.current = session.token;
    void runDash({}, { quiet: true });
  }, [session, held, runDash]);

  useEffect(() => { setMintTx(loadMintTx(accountId)); }, [accountId]);
  useEffect(() => { setSlowKey(false); if (!lookingUp) return; const id = setTimeout(() => setSlowKey(true), 12_000); return () => clearTimeout(id); }, [lookingUp]);

  const d = dash.res?.output?.ok ? dash.res.output : null;
  const s = status.res?.output ?? (d ? { ...d, ok: true } : undefined);
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
  const balances = (balance.res?.output?.ok ? balance.res.output.balances as Bal[] : d ? d.balances as Bal[] : null);
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
    for (const card of [status, account, balance, history, withdraw, limits, pnl]) if (card !== keep) card.clear();
  };
  const clearStatus = status.clear;
  const clearAccount = account.clear;
  const clearBalance = balance.clear;
  const clearHistory = history.clear;
  // A redirect wallet returns with a withdrawal pending: reopen its sheet and show what it was for.
  useEffect(() => {
    const ctx = pending?.ctx;
    if (!ctx) return;
    clearStatus(); clearAccount(); clearBalance(); clearHistory();
    if (ctx.op === "withdraw") { setDoneWithdraw({ amount: ctx.amount, to: ctx.to }); setWOpen(true); }
  }, [pending, clearStatus, clearAccount, clearBalance, clearHistory]);
  useEffect(() => { if (withdraw.res) sessionStorage.removeItem(OP_CTX); }, [withdraw.res]);
  useEffect(() => {
    if (!balances) return;
    let cancel = false;
    fetch("/api/prices").then((r) => (r.ok ? r.json() : null)).then((j) => { if (!cancel && j?.prices) setPrices(j.prices); }).catch(() => {});
    return () => { cancel = true; };
  }, [balances]);
  const readBalance = balance.run;
  useEffect(() => {
    const out = withdraw.res?.output;
    if (!out?.ok || out.op !== "withdraw" || !session) return;
    void readBalance({}, { quiet: true });
  }, [withdraw.res, readBalance, session]);

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

  const balanceLabel = balances
    ? (sessionLive ? "Refresh balance (session, no popup)" : "Refresh balance")
    : (sessionLive ? "Unseal (session, no popup)" : "Unseal");
  const totalText = totalKind.kind === "unread" ? t("vault.sealed") : totalKind.kind === "empty" ? formatUsdMicro(0) : totalKind.kind === "amounts" ? totalKind.text : formatUsdMicro(totalKind.micro);

  const limitsPanel = (
    <div className="vlt-stack">
      {s?.ok ? (
        <>
          <p className="vlt-cap" data-testid="limits-label">{lowered ? t("vault.limitsLabelOwn", { tier: t(`finish.${finish}`), tx: fmtUsd(tierCaps!.per_tx_usd_micro), day: fmtUsd(tierCaps!.daily_usd_micro) }) : t("vault.limitsLabel", { tier: t(`finish.${finish}`) })}</p>
          <Meter label={t("vault.perTx")} value={t("vault.capOnly", { cap: fmtUsd(perCap) })} testid="per-trade-meter" />
          <Meter label={t("vault.today")} value={t("vault.ofCap", { used: fmtUsd(spent ?? 0), cap: fmtUsd(dayCap) })} pct={dayPct} note={t("vault.utc", { time: utcReset })} />
        </>
      ) : sessionLive ? (
        dash.busy || !dash.res ? <p className="vlt-sub" data-testid="limits-reading"><Busy l="Reading your caps with your session" /></p>
          : <><p className="vlt-sub">Could not read your caps with the session.</p>{dash.res.error && <ErrorBox code={dash.res.error.code} />}<Button variant="secondary" size="sm" testid="dash-retry" onClick={() => void runDash({})}>Read caps and balance (session, no popup)</Button></>
      ) : <p className="vlt-sub">{t("vault.limitsUnread")}</p>}
      {pendingLim && <p className="note-box" data-testid="limits-pending">{t("vault.limitsPending", { tx: fmtUsd(pendingLim.per_tx_usd_micro), day: fmtUsd(pendingLim.daily_usd_micro), time: new Date(pendingLim.effective_ms).toISOString().slice(0, 16).replace("T", " ") })}</p>}
      <div className="vlt-actions">
        <Button variant="secondary" size="sm" loading={status.busy} loadingLabel={status.label} testid="status-btn" onClick={() => { clearOtherErrors(status); void status.run({}); }}>
          {status.busy ? status.label : t("vault.status")}
        </Button>
      </div>
      {status.res?.error && <ErrorBox code={status.res.error.code} retryAfter={status.res.error.retry_after} vars={{ cap: capFrom(status.res.error.message) }} />}
      {status.res && <Attested r={status.res} />}
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

  const lockPanel = (
    <div className="vlt-stack" data-testid="lock-panel">
      {!s?.ok ? <p className="vlt-sub">Read your limits on the Limits tab to see the lock state.</p>
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
          <h1>{t("vault.title")}</h1>
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

      {online === false ? (
        <div><OfflineState /><HowStrip /></div>
      ) : !accountId ? (
        <div>
          <EmptyState title={t("empty.vaultTitle")} body={t("empty.vaultBody")} testid="vault-empty">
            <button className="btn b1" onClick={connect} data-testid="vault-connect">{t("nav.connect")}</button>
            <Link className="btn b2" href="/mint">{t("mint.title")}</Link>
            <Link className="btn b2" href="/demo" data-testid="vault-demo-link">No wallet? See the demo vault</Link>
          </EmptyState>
          <HowStrip active={1} />
        </div>
      ) : lookingUp ? (
        <p className="note" data-testid="key-loading"><Spinner label="Looking up your key" /> {t("vault.keyLoading")}{slowKey && <span data-testid="key-slow"> The NEAR RPC is slow right now. <button type="button" className="vlt-link" onClick={() => location.reload()}>Try again</button></span>}</p>
      ) : keyMiss ? (
        <div>
          <EmptyState title={t("vault.holderOnly")} body={t("vault.holderOnlyBody")} testid="holder-only">
            <Link className="btn b1" href="/start" data-testid="vault-start">Start setup (3 popups)</Link> <Link className="btn b2" href="/mint">{t("vault.mintFirst")}</Link>
          </EmptyState>
          <HowStrip active={1} />
        </div>
      ) : (
        <>
          {held && !session && <p className="note" data-testid="vault-setup"><Link href="/start">New here? Finish setup in 5 steps →</Link></p>}
          {held && mintTx && <p className="note" data-testid="vault-mint-tx">Key minted · <TxLink hash={mintTx} /></p>}
          {held && !mintTx && <p className="note" data-testid="vault-key-link">Your key: <Link href={`/key?id=${encodeURIComponent(held.token.token_id)}`}>full history</Link> · <a href={acct(KEYS_CONTRACT)} target="_blank" rel="noreferrer">key contract on NearBlocks ↗</a></p>}

          <Card tone="banner" as="section" className="c vlt-hero" testid="balance-card" aria-labelledby="vlt-hero-cap">
            <div className="vlt-hero-top">
              <p id="vlt-hero-cap" className="vlt-cap">Vault balance</p>
              <span className="vlt-src">{balances ? ((balance.res?.output?.ok ? balance.via : dash.via) === "session" ? t("vault.balanceSession") : t("vault.balanceReal")) : t("vault.sealedBook")}</span>
            </div>
            <p className="vlt-total" data-testid="vault-total">{totalText}</p>
            {totalKind.kind === "partial" && <p className="vlt-src" data-testid="unpriced">{t("vault.unpriced", { amounts: totalKind.unpriced.join(" · ") })}</p>}
            <div className="vlt-actions">
              <Button variant="banner" testid="balance-btn" loading={balance.busy} loadingLabel={balance.label} onClick={() => { clearOtherErrors(balance); void balance.run({}); }}>
                {balance.busy ? balance.label : balanceLabel}
              </Button>
              <Button variant="secondary" testid="open-deposit" onClick={() => setDepOpen(true)}>Deposit</Button>
              <Button variant="secondary" testid="open-withdraw" onClick={() => setWOpen(true)}>Withdraw</Button>
            </div>
            {balance.res?.error && <ErrorBox code={balance.res.error.code} retryAfter={balance.res.error.retry_after} />}
            {balance.res && <Attested r={balance.res} />}
          </Card>

          <div className="vlt-grid">
            <div className="vlt-main">
              <Card as="section" className="c vlt-card" testid="assets-card" aria-labelledby="vlt-assets-h">
                <div className="vlt-cardhead">
                  <h2 id="vlt-assets-h">Assets</h2>
                  {balances && <span className="vlt-cap">{t("vault.assets", { n: balances.length })}</span>}
                </div>
                {!balances && <p className="vlt-sub">{t("vault.sealedBook")}</p>}
                {balances && balances.length === 0 && <p className="vlt-sub">{t("vault.empty")}</p>}
                {rows && rows.length > 0 && (
                  <div className="assets" data-testid="asset-list">
                    {rows.map((b) => (
                      <div className="arow" key={b.key} data-token={b.symbol}>
                        <TokenIcon assetId={b.known ? b.key : null} symbol={b.symbol} size="md" />
                        <div className="who"><b>{b.symbol}</b>{b.name ? <small>{b.name}</small> : null}</div>
                        <div className="amt"><b>{b.amountLabel}</b>{b.usdMicro != null ? <small>{formatUsdMicro(b.usdMicro)}</small> : null}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card as="section" className="c vlt-card" testid="activity-card" aria-labelledby="vlt-activity-h">
                <div className="vlt-cardhead">
                  <h2 id="vlt-activity-h">{t("vault.activity")}</h2>
                  <Button variant="secondary" size="sm" loading={history.busy} loadingLabel={history.label} onClick={() => { clearOtherErrors(history); void history.run({}); }}>{t("vault.history")}</Button>
                </div>
                {!history.res && <p className="vlt-sub">{t("vault.activityHint")}</p>}
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
                <div className="vlt-actions">
                  <Button variant="secondary" size="sm" loading={pnl.busy} loadingLabel={pnl.label} testid="pnl-btn" onClick={() => { clearOtherErrors(pnl); void pnl.run({}); }}>{t("vault.pnlBtn")}</Button>
                </div>
                <p className="vlt-sub">{t("vault.pnlHelp")}</p>
                {pnl.res?.output && (pnl.res.output as { statement?: string }).statement && (() => {
                  const o = pnl.res!.output as { statement: string; sig: string; minter: string };
                  const href = `/pnl#${encodeShare({ statement: o.statement, sig: o.sig, minter: o.minter, call_id: pnl.res!.call_id })}`;
                  return <p className="vlt-sub" data-testid="pnl-link"><Link href={href}>{t("vault.pnlOpen")}</Link></p>;
                })()}
                {pnl.res?.error && <ErrorBox code={pnl.res.error.code} retryAfter={pnl.res.error.retry_after} />}
              </Card>
            </div>

            <div className="vlt-side">
              <Card as="section" className="c vlt-card" testid="key-card" aria-labelledby="vlt-key-h">
                <div className="vlt-cardhead">
                  <h2 id="vlt-key-h">Your key</h2>
                  {idn && held ? <span className="vlt-state ok" data-state={keyState(held.token, held.tier, accountId)}><i />{t(`gallery.${keyState(held.token, held.tier, accountId)}`)}</span> : null}
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

              <Card as="section" className="c vlt-card" testid="settings-card" aria-labelledby="vlt-set-h">
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
                  {tab === "session" && (held ? <SessionCard tokenId={held.token.token_id} /> : <p className="vlt-sub">Mint a key to unlock a session.</p>)}
                  {tab === "lock" && lockPanel}
                </div>
              </Card>

              <Card as="section" className="c vlt-card" testid="vault-swap-card" aria-labelledby="vlt-swap-h">
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
        <p className="vlt-sub">{t("vault.fundLead")}</p>
        <div className="vlt-stack">
          <div className="vlt-field">
            <span className="vlt-label">{t("vault.asset")}</span>
            <TokenSelect label={t("vault.asset")} options={TOKEN_OPTIONS} value={ASSETS[fundAsset].id} onChange={(id) => setFundAsset(keyOfId(id))} testid="fund-asset" />
          </div>
          <AmountInput label={t("vault.amount")} value={fundAmt} onChange={setFundAmt} symbol={ASSETS[fundAsset].symbol} error={fundUnits ? null : t("vault.badAmount")} testid="fund-amt" />
          <Button block testid="fund-btn" loading={account.busy} loadingLabel={account.label} disabled={!fundUnits || account.busy} onClick={() => { if (fundUnits && accountId) { clearOtherErrors(account); void account.run(fundParams(fundAsset, fundUnits)); } }}>
            {account.busy ? account.label : t("vault.fundBtn")}
          </Button>
          {account.res?.output?.ok && typeof account.res.output.deposit?.deposit_address === "string" && (
            <div className="vlt-stack" data-testid="deposit">
              <span className="vlt-label">{t("vault.deposit")}</span>
              <DepositQr evm={accountId && /^0x[0-9a-fA-F]{40}$/.test(accountId) ? accountId : null} address={String(account.res.output.deposit.deposit_address)} amount={`${fundAmt} ${ASSETS[fundAsset].symbol}`} />
              {typeof account.res.output.deposit.hint === "string" && <p className="vlt-sub">{String(account.res.output.deposit.hint)}</p>}
              {typeof account.res.output.deposit.expires_at === "string" && <p className="vlt-sub">{t("vault.expires", { time: String(account.res.output.deposit.expires_at) })}</p>}
            </div>
          )}
          {account.res?.error && <ErrorBox code={account.res.error.code} retryAfter={account.res.error.retry_after} />}
          {account.res && <Attested r={account.res} />}
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
