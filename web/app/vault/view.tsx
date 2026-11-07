"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Attested, ErrorBox, OfflineState, capFrom } from "@/components/Result";
import { TxLink } from "@/components/TxLink";
import { loadMintTx } from "@/lib/mintTx";
import { HowStrip } from "@/components/HowStrip";
import { EmptyState } from "@/components/EmptyState";
import { Cipher } from "@/components/Cipher";
import { KeyArt } from "@/components/Art";
import { Guilloche, Hallmark } from "@/components/Engraving";
import { FoilCard } from "@/components/FoilCard";
import { Medal } from "@/components/Medal";
import { TokenPick } from "@/components/TokenPick";
import { useI18n } from "@/lib/i18n";
import { useWallet } from "@/lib/wallet";
import { useSigned } from "@/lib/useSigned";
import { encodeShare } from "@/lib/pnl";
import { useHealth } from "@/lib/useHealth";
import { ASSETS, toBaseUnits, type AssetKey } from "@/lib/assets";
import { fundParams, swapParams, withdrawParams } from "@/lib/trade";
import { keyState, nftTier, shortAccount, shortKeyId, tierName, tokensFor, type Token } from "@/lib/near";
import { acct, acctAlt, attestation, intentTx, KEYS_CONTRACT, WORKER_WASM_SHA256 } from "@/lib/config";
import { SessionCard } from "@/components/SessionCard";
import { DepositQr } from "@/components/DepositQr";
import { assetRows, formatUsdMicro, isImplicitAccount, totalOf, tradeSummary, withdrawSummary, type PriceBook } from "@/lib/amount";
import { OP_CTX, type OpResume } from "@/lib/wallet";
import { copyText } from "@/lib/copyText";
import { publishedBuild, staticChecks, type Attestation } from "@/lib/verify";
import { CAPS, keyIdentity, serialOf, type Finish } from "@/lib/traits";
import { traitLabel } from "@/components/KeyCard";
import { KeyLog } from "@/components/KeyLog";
import "./vault.css";
import { MetaMaskNote } from "@/components/MetaMaskNote";
import { Busy, Spinner } from "@/components/ui";

type Bal = { token?: string; symbol?: string; amount?: string; balance?: string; usd?: number; usd_micro?: number };
type Hist = { ts_ms?: number; kind?: string; token_in?: string; token_out?: string; amount_in?: string; amount_out?: string; usd_in_micro?: number; token?: string; amount?: string; chain?: string; status?: string };

export function VaultView({ initialOnline, initialPrices = {} }: { initialOnline: boolean; initialPrices?: PriceBook }) {
  const { t, fmtUsd } = useI18n();
  const { accountId, connect, pending, session } = useWallet();
  const online = useHealth(initialOnline);
  const status = useSigned("status");
  const quote = useSigned("quote");
  const account = useSigned("account");
  const balance = useSigned("balance");
  const history = useSigned("history");
  const swap = useSigned("swap");
  const withdraw = useSigned("withdraw");
  const limits = useSigned("limits");
  const pnl = useSigned("pnl");
  const dash = useSigned("dashboard");
  const [limTx, setLimTx] = useState("");
  const [limDay, setLimDay] = useState("");
  const [from, setFrom] = useState<AssetKey>("usdc");
  const [toKey, setToKey] = useState<AssetKey>("wnear");
  const [amount, setAmount] = useState("0.05");
  const [fundAsset, setFundAsset] = useState<AssetKey>("usdc");
  const [fundAmt, setFundAmt] = useState("1");
  const [wAsset, setWAsset] = useState<AssetKey>("usdc");
  const [wAmt, setWAmt] = useState("0.05");
  const [quoted, setQuoted] = useState<{ key: string; minOut?: string } | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(2);
  const [held, setHeld] = useState<{ token: Token; tier: number | null } | null>(null);
  const [keysFor, setKeysFor] = useState<string | null>(null);
  const [keysReady, setKeysReady] = useState(false);
  const [keyMiss, setKeyMiss] = useState(false);
  const [doneTrade, setDoneTrade] = useState<{ give: string; decimals: number; symbol: string } | null>(null);
  const [doneWithdraw, setDoneWithdraw] = useState<{ amount: string; to: string } | null>(null);
  const [prices, setPrices] = useState(initialPrices);
  const units = toBaseUnits(amount, ASSETS[from].decimals);
  const fundUnits = toBaseUnits(fundAmt, ASSETS[fundAsset].decimals);
  const wUnits = toBaseUnits(wAmt, ASSETS[wAsset].decimals);
  const tradeKey = `${from}:${toKey}:${units ?? ""}`;
  const utcReset = (() => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); })();
  useEffect(() => {
    if (!accountId) { setHeld(null); setKeysFor(null); setKeysReady(false); setKeyMiss(false); return; }
    let cancel = false;
    setKeysFor(accountId);
    setKeysReady(false);
    setHeld(null);
    setKeyMiss(false);
    tokensFor(accountId).then(async (toks) => {
      const token = toks[0];
      if (!token || cancel) { if (!cancel) { setHeld(null); setKeyMiss(true); setKeysReady(true); } return; }
      const tier = await nftTier(token.token_id).catch(() => null);
      if (!cancel) { setHeld({ token, tier }); setKeyMiss(false); setKeysReady(true); }
    }).catch(() => { if (!cancel) { setHeld(null); setKeyMiss(false); setKeysReady(true); } });
    return () => { cancel = true; };
  }, [accountId]);

  const quoteKey = useRef("");
  const runQuote = quote.run;
  // With a session a quote costs no popup, so re-quote automatically (debounced) when the trade changes.
  useEffect(() => {
    if (!session || !held || !units || !accountId || from === toKey || quoteKey.current === tradeKey) return;
    const id = setTimeout(() => { quoteKey.current = tradeKey; void runQuote({ origin_asset: ASSETS[from].id, destination_asset: ASSETS[toKey].id, amount: units, refund_to: accountId, recipient: accountId, refund_type: "INTENTS", recipient_type: "INTENTS", deposit_type: "INTENTS", confidentiality: "basic", execute: false }, { quiet: true }); }, 800);
    return () => clearTimeout(id);
  }, [session, held, units, accountId, from, toKey, tradeKey, runQuote]);
  useEffect(() => {
    if (!quote.res) return;
    if (!quote.res.output?.ok) { setQuoted(null); return; }
    const min = quote.res.output.quote?.minAmountOut;
    setQuoted({ key: quoteKey.current, minOut: typeof min === "string" && /^\d+$/.test(min) ? min : undefined });
  }, [quote.res]);
  const d = dash.res?.output?.ok ? dash.res.output : null;
  const s = status.res?.output ?? (d ? { ...d, ok: true } : undefined);
  const q = quote.res?.output;
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
  const idn = held ? keyIdentity(held.token.token_id, held.tier) : null;
  const balances = (balance.res?.output?.ok ? balance.res.output.balances as Bal[] : d ? d.balances as Bal[] : null);
  const rows = balances ? assetRows(balances, prices) : null;
  const totalKind = totalOf(rows);
  const entries = (history.res?.output?.ok ? history.res.output.entries as Hist[] : null);
  // With a live session, one dashboard read fills limits, balance and state (no wallet popup).
  const runDash = dash.run;
  const dashFor = useRef("");
  useEffect(() => {
    if (!session || !held || session.token_id !== held.token.token_id) return;
    if (dashFor.current === session.token) return;
    dashFor.current = session.token;
    void runDash({}, { quiet: true });
  }, [session, held, runDash]);
  const [mintTx, setMintTx] = useState<string | null>(null);
  useEffect(() => { setMintTx(loadMintTx(accountId)); }, [accountId]);
  const sessionLive = !!(session && held && session.token_id === held.token.token_id);
  const [logVerified, setLogVerified] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedConf, setCopiedConf] = useState(false);
  useEffect(() => {
    const id = history.res?.call_id;
    if (!history.res?.output?.ok || !id) { setLogVerified(null); return; }
    let cancel = false;
    setLogVerified(null);
    fetch(attestation(id)).then((r) => { if (!r.ok) throw new Error(); return r.json(); }).then((a: Attestation) => {
      if (cancel) return;
      const st = staticChecks(a);
      setLogVerified(st.quote && st.registered && publishedBuild(a.executed_wasm_sha256));
    }).catch(() => { if (!cancel) setLogVerified(false); });
    return () => { cancel = true; };
  }, [history.res]);
  const lookingUpKey = !!accountId && (!keysReady || keysFor !== accountId);
  const [slowKey, setSlowKey] = useState(false);
  useEffect(() => { setSlowKey(false); if (!lookingUpKey) return; const id = setTimeout(() => setSlowKey(true), 12_000); return () => clearTimeout(id); }, [lookingUpKey]);
  const clearOtherErrors = (keep: { clear: () => void }) => {
    for (const card of [status, quote, account, balance, history, swap, withdraw, limits, pnl]) if (card !== keep) card.clear();
  };
  const clearStatus = status.clear;
  const clearQuote = quote.clear;
  const clearAccount = account.clear;
  const clearBalance = balance.clear;
  const clearHistory = history.clear;
  const clearSwap = swap.clear;
  const clearWithdraw = withdraw.clear;
  useEffect(() => {
    const ctx = pending?.ctx;
    if (!ctx) return;
    clearStatus(); clearQuote(); clearAccount(); clearBalance(); clearHistory();
    if (ctx.op === "swap") { clearWithdraw(); setDoneTrade({ give: ctx.give, decimals: ctx.decimals, symbol: ctx.symbol }); setStep(2); }
    if (ctx.op === "withdraw") { clearSwap(); setDoneWithdraw({ amount: ctx.amount, to: ctx.to }); setStep(3); }
  }, [pending, clearStatus, clearQuote, clearAccount, clearBalance, clearHistory, clearSwap, clearWithdraw]);
  useEffect(() => {
    if (swap.res || withdraw.res) sessionStorage.removeItem(OP_CTX);
  }, [swap.res, withdraw.res]);
  useEffect(() => {
    if (!balances) return;
    let cancel = false;
    fetch("/api/prices").then((r) => r.ok ? r.json() : null).then((j) => {
      if (!cancel && j?.prices) setPrices(j.prices);
    }).catch(() => {});
    return () => { cancel = true; };
  }, [balances]);
  const readBalance = balance.run;
  useEffect(() => {
    const out = swap.res?.output;
    if (!out?.ok || out.op !== "swap" || !session) return;
    void readBalance({}, { quiet: true });
  }, [swap.res, readBalance, session]);
  useEffect(() => {
    const out = withdraw.res?.output;
    if (!out?.ok || out.op !== "withdraw" || !session) return;
    void readBalance({}, { quiet: true });
  }, [withdraw.res, readBalance, session]);

  const dayPct = Math.min(100, ((spent ?? 0) / dayCap) * 100);
  const txUsed = q?.ok && quoted?.key === tradeKey ? q.usd_micro : null;
  const txPct = txUsed == null ? 0 : Math.min(100, (txUsed / perCap) * 100);
  const tone = (p: number) => (p >= 100 ? " full" : p >= 80 ? " warn" : "");
  const lockUntil = s?.ok ? (s.locked_until_ms as number | null | undefined) : null;
  const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
  const stateBadge = !s?.ok ? null : lockUntil
    ? <span className="vbadge lock" data-testid="state-badge" data-state="locked"><i />{t("vault.stLocked", { time: hhmm(lockUntil) })}</span>
    : coolUntil
      ? <span className="vbadge cool" data-testid="state-badge" data-state="cooldown"><i />{t("vault.stCooldown", { time: hhmm(coolUntil) })}</span>
      : <span className="vbadge ok" data-testid="state-badge" data-state="open"><i />{t("vault.stOpen")}</span>;
  const tabs = [1, 2, 3] as const;

  return (
    <div className="page vlt">
      <div className="vhead">
        <div>
          <p className="eb">{accountId ? t("vault.eyebrow", { account: shortAccount(accountId) }) : t("vault.eyebrowOff")}</p>
          <h1>{t("vault.title")}</h1>
          {accountId && (
            <p className="acct-line">
              <span className="id" data-testid="vault-account">{accountId}</span>
              <button type="button" onClick={() => { void copyText(accountId).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }); }}>{copied ? t("nav.copied") : t("nav.copy")}</button>
            </p>
          )}
        </div>
        <div className="chips">
          {stateBadge}
          {online === true && <span className="chip"><i />{t("vault.live", { hash: WORKER_WASM_SHA256[0].slice(0, 8) })}</span>}
          {online === null && <span className="chip wait" data-testid="enclave-checking"><i />{t("vault.checking")}</span>}
        </div>
      </div>
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
      ) : lookingUpKey ? (
        <p className="note" data-testid="key-loading"><Spinner label="Looking up your key" /> {t("vault.keyLoading")}{slowKey && <span data-testid="key-slow"> The NEAR RPC is slow right now. <button type="button" className="linkbtn" onClick={() => location.reload()}>Try again</button></span>}</p>
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
        {held && <SessionCard tokenId={held.token.token_id} />}
        {held && mintTx && <p className="note" data-testid="vault-mint-tx">Key minted · <TxLink hash={mintTx} /></p>}
        {held && !mintTx && <p className="note" data-testid="vault-key-link">Your key: <Link href={`/key?id=${encodeURIComponent(held.token.token_id)}`}>full history</Link> · <a href={acct(KEYS_CONTRACT)} target="_blank" rel="noreferrer">key contract on NearBlocks ↗</a></p>}
        <div className="vlt-grid">
          <div className="vlt-col">
            <section className="c vcard" data-testid="key-card">
              <header className="vhd"><h2>{t("vault.cardKey")}</h2>{idn && held ? <span className="vbadge ok" data-state={keyState(held.token, held.tier, accountId)}><i />{t(`gallery.${keyState(held.token, held.tier, accountId)}`)}</span> : null}</header>
              {idn && held ? (
                <>
                  <div className="vkey">
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
                    <dl className="kv" data-testid="vault-traits">
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
                <div className="vempty">{t("vault.nokey")} <Link href="/mint">{t("vault.mintFirst")}</Link></div>
              )}
            </section>

            <section className="c vcard" data-testid="limits-card">
              <header className="vhd"><h2>{t("vault.cardLimits")}</h2><span className="side">{pendingLim ? <span className="vbadge pend" data-testid="pending-badge"><i />{t("vault.stPending")}</span> : null}<span className="vbadge mute">{tierName(tierNum === 3 ? 3 : tierNum === 2 ? 2 : tierNum === 1 ? 1 : null)}</span></span></header>
              <p className="vcap" data-testid="limits-label">{lowered ? t("vault.limitsLabelOwn", { tier: t(`finish.${finish}`), tx: fmtUsd(tierCaps!.per_tx_usd_micro), day: fmtUsd(tierCaps!.daily_usd_micro) }) : t("vault.limitsLabel", { tier: t(`finish.${finish}`) })}</p>
              {s?.ok ? (
                <>
                  <div className={`vmeter${tone(txPct)}`}>
                    <p className="top"><span>{t("vault.perTx")}</span><span data-testid="per-trade-meter">{txUsed == null ? t("vault.capOnly", { cap: fmtUsd(perCap) }) : t("vault.quotePreview", { used: fmtUsd(txUsed), cap: fmtUsd(perCap) })}</span></p>
                    <div className="tr"><i style={{ width: `${txPct}%` }} /></div>
                    <small>{txUsed == null ? t("vault.meterTxNone") : t("vault.meterTx", { pct: Math.round(txPct) })}</small>
                  </div>
                  <div className={`vmeter${tone(dayPct)}`}>
                    <p className="top"><span>{t("vault.today")}</span><span>{t("vault.ofCap", { used: fmtUsd(spent ?? 0), cap: fmtUsd(dayCap) })}</span></p>
                    <div className="tr"><i style={{ width: `${dayPct}%` }} /></div>
                    <small>{t("vault.utc", { time: utcReset })}</small>
                  </div>
                </>
              ) : sessionLive ? (
                dash.busy || !dash.res ? <p className="note" data-testid="limits-reading"><Busy l="Reading your caps with your session" /></p>
                  : <><p className="note">Could not read your caps with the session.</p>{dash.res.error && <ErrorBox code={dash.res.error.code} />}<button className="vbtn sec" type="button" data-testid="dash-retry" onClick={() => void runDash({})}>Read caps and balance (session, no popup)</button></>
              ) : <p className="note">{t("vault.limitsUnread")}</p>}
              {pendingLim && <p className="note-box" data-testid="limits-pending">{t("vault.limitsPending", { tx: fmtUsd(pendingLim.per_tx_usd_micro), day: fmtUsd(pendingLim.daily_usd_micro), time: new Date(pendingLim.effective_ms).toISOString().slice(0, 16).replace("T", " ") })}</p>}
              <div className="vact"><button className="vbtn sec" disabled={status.busy} onClick={() => { clearOtherErrors(status); void status.run({}); }} data-testid="status-btn">{status.busy ? <Busy l={status.label} /> : t("vault.status")}</button></div>
              {status.res?.error && <ErrorBox code={status.res.error.code} retryAfter={status.res.error.retry_after} vars={{ cap: capFrom(status.res.error.message) }} />}
              {status.res && <Attested r={status.res} />}
              {s?.ok && held && (
                <>
                  <hr className="vline" />
                  <form className="vform" data-testid="limits-form" onSubmit={(e) => { e.preventDefault(); const a = usdMicro(limTx), b = usdMicro(limDay); if (!a || !b) return; clearOtherErrors(limits); void limits.run({ per_tx_usd_micro: a, daily_usd_micro: b }); }}>
                    <div>
                      <p className="vcap">{t("vault.myLimits")}</p>
                      <p className="vhelp" style={{ marginTop: 6 }}>{t("vault.myLimitsNote")}</p>
                    </div>
                    <div className="vrow">
                      <div className="vfield">
                        <label htmlFor="lim-tx">{t("vault.limPerTx")}</label>
                        <div className="vbox" aria-invalid={!!limTx && !usdMicro(limTx)}><span className="u">$</span><input id="lim-tx" inputMode="decimal" placeholder={(perCap / 1e6).toString()} value={limTx} onChange={(e) => setLimTx(e.target.value)} data-testid="lim-tx" /></div>
                      </div>
                      <div className="vfield">
                        <label htmlFor="lim-day">{t("vault.limDay")}</label>
                        <div className="vbox" aria-invalid={!!limDay && !usdMicro(limDay)}><span className="u">$</span><input id="lim-day" inputMode="decimal" placeholder={(dayCap / 1e6).toString()} value={limDay} onChange={(e) => setLimDay(e.target.value)} data-testid="lim-day" /></div>
                      </div>
                    </div>
                    {tierCaps && <p className="vhelp">{t("vault.limHelp", { tx: fmtUsd(tierCaps.per_tx_usd_micro), day: fmtUsd(tierCaps.daily_usd_micro) })}</p>}
                    <button className="vbtn pri block" type="submit" disabled={limits.busy || !usdMicro(limTx) || !usdMicro(limDay)} data-testid="limits-btn">{limits.busy ? <Busy l={limits.label} /> : t("vault.setLimits")}</button>
                    {lo?.ok && <p className="note" data-testid="limits-out">{t("vault.limitsNow", { tx: fmtUsd(lo.limits.per_tx_usd_micro), day: fmtUsd(lo.limits.daily_usd_micro) })}</p>}
                    {limits.res?.error && <ErrorBox code={limits.res.error.code} retryAfter={limits.res.error.retry_after} />}
                    {limits.res && <Attested r={limits.res} />}
                  </form>
                </>
              )}
            </section>
          </div>

          <div className="vlt-col">
            <section className="c vcard" data-testid="balance-card">
              <header className="vhd"><h2>{t("vault.cardBalance")}</h2><span className="side"><span className="vbadge mute">{balances ? t("vault.read") : t("vault.sealed")}</span></span></header>
              <div>
                <p className="vcap">{t("vault.total")}</p>
                <div className="vtotal">
                  <p className="big" data-testid="vault-total">{totalKind.kind === "unread" ? "—" : totalKind.kind === "empty" ? formatUsdMicro(0) : totalKind.kind === "amounts" ? totalKind.text : formatUsdMicro(totalKind.micro)}</p>
                </div>
                {totalKind.kind === "partial" && <p className="note" data-testid="unpriced">{t("vault.unpriced", { amounts: totalKind.unpriced.join(" · ") })}</p>}
                <p className="note" style={{ marginTop: 6 }}>{balances ? ((balance.res?.output?.ok ? balance.via : dash.via) === "session" ? t("vault.balanceSession") : t("vault.balanceReal")) : t("vault.sealedBook")}</p>
              </div>
              <div>
                <p className="vcap" style={{ marginBottom: 6 }}>{t("vault.assets", { n: balances?.length ?? 0 })}</p>
                {!balances && <div className="vempty">{t("vault.sealedBook")}</div>}
                {balances && balances.length === 0 && <div className="vempty">{t("vault.empty")}</div>}
                {rows && rows.length > 0 && (
                  <div className="assets" data-testid="asset-list">
                    {rows.map((b) => (
                      <div className={`arow${b.logo ? "" : " plain"}`} key={b.key} data-token={b.symbol}>
                        {b.logo ? <Medal id={b.logo} name={b.symbol} /> : null}
                        <div className="who"><b>{b.symbol}</b>{b.name ? <small>{b.name}</small> : null}</div>
                        <div className="amt"><b>{b.amountLabel}</b>{b.usdMicro != null ? <small>{formatUsdMicro(b.usdMicro)}</small> : null}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="vact">
                <button className="vbtn pri" disabled={balance.busy} onClick={() => { clearOtherErrors(balance); void balance.run({}); }} data-testid="balance-btn">{balance.busy ? <Busy l={balance.label} /> : sessionLive ? "Refresh balance (session, no popup)" : t("vault.balance")}</button>
                <button className="vbtn sec" disabled={account.busy} onClick={() => { clearOtherErrors(account); void account.run({}); }} data-testid="account-btn">{account.busy ? <Busy l={account.label} /> : t("vault.open")}</button>
              </div>
              {account.res?.output?.ok && (
                <div className="vfield" data-testid="confidential-id">
                  <span className="vl">{t("vault.sendTo")}</span>
                  <div className="vbox ro"><span className="v">{String(account.res.output.confidential_id)}</span>
                    <button type="button" className="vbtn sec sm" onClick={() => { const id = String(account.res?.output?.confidential_id ?? ""); void copyText(id).then(() => { setCopiedConf(true); window.setTimeout(() => setCopiedConf(false), 1600); }); }}>{copiedConf ? t("nav.copied") : t("nav.copy")}</button>
                  </div>
                </div>
              )}
              {balance.res?.error && <ErrorBox code={balance.res.error.code} retryAfter={balance.res.error.retry_after} />}
              {balance.res && <Attested r={balance.res} />}
            </section>

            <section className="c vcard" data-testid="move-card">
              <header className="vhd"><h2>{t("vault.cardMove")}</h2><span className="side"><span className="vbadge mute" data-testid="caps">{t("vault.capsLine", { finish: t(`finish.${finish}`), tx: fmtUsd(perCap), day: fmtUsd(dayCap) })}</span></span></header>
              {lockUntil ? <p className="note-box" data-testid="lock-note">{t("vault.lockNote", { time: hhmm(lockUntil) })}</p> : null}
              <div className="vtabs" role="tablist">
                {tabs.map((n) => (
                  <button key={n} type="button" role="tab" aria-selected={step === n} onClick={() => setStep(n)}>{t(n === 1 ? "vault.stepFund" : n === 2 ? "vault.stepTrade" : "vault.stepWithdraw")}</button>
                ))}
              </div>
              {step === 1 && <div className="vform" role="tabpanel">
                <p className="vsub">{t("vault.fundLead")}</p>
                <div className="vrow">
                  <div className="vfield"><label htmlFor="fund-asset">{t("vault.asset")}</label><div className="vbox pick"><TokenPick id="fund-asset" value={fundAsset} onChange={setFundAsset} /></div></div>
                  <div className="vfield"><label htmlFor="fund-amt">{t("vault.amount")}</label><div className="vbox" aria-invalid={!fundUnits}><input id="fund-amt" inputMode="decimal" value={fundAmt} onChange={(e) => setFundAmt(e.target.value)} /><span className="u">{ASSETS[fundAsset].symbol}</span></div>{!fundUnits && <p className="vhelp err">{t("vault.badAmount")}</p>}</div>
                </div>
                <button className="vbtn pri block" type="button" disabled={!fundUnits || account.busy} data-testid="fund-btn" onClick={() => { if (fundUnits && accountId) { clearOtherErrors(account); void account.run(fundParams(fundAsset, fundUnits)); } }}>{account.busy ? <Busy l={account.label} /> : t("vault.fundBtn")}</button>
                {account.res?.output?.ok && typeof account.res.output.deposit?.deposit_address === "string" && (
                  <div className="vfield" data-testid="deposit">
                    <span className="vl">{t("vault.deposit")}</span>
                    <DepositQr evm={accountId && /^0x[0-9a-fA-F]{40}$/.test(accountId) ? accountId : null} address={String(account.res.output.deposit.deposit_address)} amount={`${fundAmt} ${ASSETS[fundAsset].symbol}`} />
                    {typeof account.res.output.deposit.hint === "string" && <p className="vhelp">{String(account.res.output.deposit.hint)}</p>}
                    {typeof account.res.output.deposit.expires_at === "string" && <p className="vhelp">{t("vault.expires", { time: String(account.res.output.deposit.expires_at) })}</p>}
                  </div>
                )}
                {account.res?.error && <ErrorBox code={account.res.error.code} retryAfter={account.res.error.retry_after} />}
                {account.res && <Attested r={account.res} />}
              </div>}
              {step === 2 && <form className="vform" role="tabpanel" onSubmit={(e) => { e.preventDefault(); if (!units || !accountId || from === toKey) return; quoteKey.current = tradeKey; clearOtherErrors(quote); swap.reset(); void quote.run({ origin_asset: ASSETS[from].id, destination_asset: ASSETS[toKey].id, amount: units, refund_to: accountId, recipient: accountId, refund_type: "INTENTS", recipient_type: "INTENTS", deposit_type: "INTENTS", confidentiality: "basic", execute: false }); }}>
                <p className="vsub">{t("vault.tradeLead")}</p>
                <div className="vrow">
                  <div className="vfield"><label htmlFor="from">{t("vault.from")}</label><div className="vbox pick"><TokenPick id="from" value={from} onChange={setFrom} /></div></div>
                  <div className="vfield"><label htmlFor="amt">{t("vault.amount")}</label><div className="vbox" aria-invalid={!units}><input id="amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /><span className="u">{ASSETS[from].symbol}</span></div>{!units && <p className="vhelp err">{t("vault.badAmount")}</p>}</div>
                </div>
                <div className="vflip"><button type="button" aria-label={t("vault.flip")} onClick={() => { const next = from; setFrom(toKey); setToKey(next); }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4v16M3 16l4 4 4-4" /><path d="M17 20V4M13 8l4-4 4 4" /></svg>
                </button></div>
                <div className="vrow">
                  <div className="vfield"><label htmlFor="to">{t("vault.to")}</label><div className="vbox pick"><TokenPick id="to" value={toKey} onChange={setToKey} /></div></div>
                  <div className="vfield"><span className="vl">{t("vault.youGet")}</span><div className="vbox ro"><span className="v">{q?.ok && quoted?.key === tradeKey ? Number(q.quote?.amountOutFormatted).toPrecision(6) : "—"}</span><span className="u" style={{ marginLeft: "auto" }}>{ASSETS[toKey].symbol}</span></div></div>
                </div>
                {from === toKey && <p className="vhelp err">{t("vault.same")}</p>}
                {q?.ok && quoted?.key === tradeKey && (
                  <div className="receipt" data-testid="quote">
                    <div className="row"><span>{t("vault.give")}</span><span>{amount} {ASSETS[from].symbol}</span></div>
                    <div className="row"><span>{t("vault.youGet")}</span><span>{Number(q.quote?.amountOutFormatted).toPrecision(6)} {ASSETS[toKey].symbol}</span></div>
                    <div className="row"><span>{t("vault.price")}</span><span>{fmtUsd(q.usd_micro)}</span></div>
                    <div className="row"><span>{t("vault.capUsed")}</span><span>{t("vault.ofCap", { used: fmtUsd(q.usd_micro), cap: fmtUsd(perCap) })}</span></div>
                  </div>
                )}
                <div className="vact">
                  <button className="vbtn sec" disabled={!units || from === toKey || quote.busy} data-testid="quote-btn">{quote.busy ? <Busy l={quote.label} /> : t("vault.get")}</button>
                  <button className="vbtn pri" type="button" data-testid="trade-btn" disabled={!units || from === toKey || quoted?.key !== tradeKey || swap.busy} onClick={() => { if (!units || !quoted || quoted.key !== tradeKey) return; const ctx: OpResume = { op: "swap", give: `${amount} ${ASSETS[from].symbol}`, decimals: ASSETS[toKey].decimals, symbol: ASSETS[toKey].symbol }; sessionStorage.setItem(OP_CTX, JSON.stringify(ctx)); setDoneTrade(ctx); clearOtherErrors(swap); void swap.run(swapParams(from, toKey, units, quoted.minOut)); }}>{swap.busy ? <Busy l={swap.label} /> : t("vault.signTrade")}</button>
                </div>
                {!swap.busy && units && from !== toKey && quoted?.key !== tradeKey && <p className="vhelp" data-testid="trade-why">{session ? "Getting a fresh quote for this amount…" : "Press “Get attested quote” for this amount first; the trade uses that exact quote."}</p>}
                {quote.res?.error && <ErrorBox code={quote.res.error.code} retryAfter={quote.res.error.retry_after} vars={{ cap: capFrom(quote.res.error.message) }} />}
                {swap.res?.error && <ErrorBox code={swap.res.error.code} retryAfter={swap.res.error.retry_after} vars={{ cap: capFrom(swap.res.error.message) }} />}
                {swap.res?.output?.ok && swap.res.output.op === "swap" && doneTrade && (
                  <div className="result-card" data-testid="trade-out">
                    <b>{tradeSummary(doneTrade.give, String(swap.res.output.amount_out ?? "0"), doneTrade.decimals, doneTrade.symbol)}</b>
                    <p className="note">{String(swap.res.output.status ?? "")}</p>
                    {swap.res.output.intent_hash && <p><a href={intentTx(String(swap.res.output.intent_hash))} target="_blank" rel="noreferrer">{t("vault.intent")} ↗</a></p>}
                    {swap.res.output.request_id && <p className="mono" style={{ fontSize: 13 }}>{t("vault.request")} {String(swap.res.output.request_id)}</p>}
                  </div>
                )}
                {quote.res && <Attested r={quote.res} />}
                {swap.res && <Attested r={swap.res} />}
              </form>}
              {step === 3 && <div className="vform" role="tabpanel">
                <p className="vsub">{t("vault.withdrawLead", { account: accountId })}</p>
                <div className="vrow">
                  <div className="vfield"><label htmlFor="w-asset">{t("vault.asset")}</label><div className="vbox pick"><TokenPick id="w-asset" value={wAsset} onChange={setWAsset} /></div></div>
                  <div className="vfield"><label htmlFor="w-amt">{t("vault.amount")}</label><div className="vbox" aria-invalid={!wUnits}><input id="w-amt" inputMode="decimal" value={wAmt} onChange={(e) => setWAmt(e.target.value)} /><span className="u">{ASSETS[wAsset].symbol}</span></div>{!wUnits && <p className="vhelp err">{t("vault.badAmount")}</p>}</div>
                </div>
                <div className="vfield"><span className="vl">{t("vault.dest")}</span><div className="vbox ro"><span className="v">{accountId}</span></div><p className="vhelp">{t("vault.destHelp")}</p></div>
                {coolUntil ? <p className="note-box" data-testid="cooldown-note">{t("vault.cooldown", { time: hhmm(coolUntil) })}</p> : null}
                <button className="vbtn pri block" type="button" data-testid="withdraw-btn" disabled={!wUnits || withdraw.busy} onClick={() => { if (wUnits && accountId) { const ctx: OpResume = { op: "withdraw", amount: `${wAmt} ${ASSETS[wAsset].symbol}`, to: shortAccount(accountId) }; sessionStorage.setItem(OP_CTX, JSON.stringify(ctx)); setDoneWithdraw(ctx); clearOtherErrors(withdraw); void withdraw.run(withdrawParams(accountId, wAsset, wUnits)); } }}>{withdraw.busy ? <Busy l={withdraw.label} /> : t("vault.withdrawBtn")}</button>
                {withdraw.res?.output?.ok && withdraw.res.output.op === "withdraw" && doneWithdraw && (
                  <div className="result-card" data-testid="withdraw-out">
                    <b>{withdrawSummary(doneWithdraw.amount, doneWithdraw.to)}</b>
                    <p className="note">{String(withdraw.res.output.status ?? "")}</p>
                    {withdraw.res.output.request_id && <p className="mono" style={{ fontSize: 13 }}>{t("vault.request")} {String(withdraw.res.output.request_id)}</p>}
                    <p className="mono" style={{ fontSize: 13 }} data-testid="withdraw-receipt">{t("vault.to")}: {String(withdraw.res.output.to ?? doneWithdraw.to)} · {t("vault.amount")}: {String(withdraw.res.output.amount ?? doneWithdraw.amount)}{withdraw.res.output.fee ? <> · {t("vault.fee")}: {String(withdraw.res.output.fee)}</> : null}</p>
                    {withdraw.res.output.tx_hash
                      ? <p data-testid="withdraw-tx"><a href={`https://nearblocks.io/txns/${String(withdraw.res.output.tx_hash)}`} target="_blank" rel="noreferrer">{t("vault.txHash")} {String(withdraw.res.output.tx_hash).slice(0, 10)}… ↗</a></p>
                      : <p className="note" data-testid="withdraw-settling">Settling: the payout transaction is sent by the custody wallet and shows on your account&apos;s explorer page within about a minute. <a href={acct(accountId || "")} target="_blank" rel="noreferrer">Open explorer ↗</a> · <a href={acctAlt(accountId || "")} target="_blank" rel="noreferrer">alt ↗</a></p>}
                    {isImplicitAccount(accountId || "") && <p className="note">{t("vault.storageNote")}</p>}
                  </div>
                )}
                {withdraw.res?.error && <ErrorBox code={withdraw.res.error.code} retryAfter={withdraw.res.error.retry_after} vars={{ cap: capFrom(withdraw.res.error.message) }} />}
                {withdraw.res && <Attested r={withdraw.res} />}
              </div>}
            </section>

            <section className="c vcard" data-testid="activity-card">
              <header className="vhd"><h2>{t("vault.activity")}</h2><span className="side"><button className="vbtn sec sm" disabled={history.busy} onClick={() => { clearOtherErrors(history); void history.run({}); }}>{history.busy ? <Busy l={history.label} /> : t("vault.history")}</button></span></header>
              {!history.res && <div className="vempty">{t("vault.activityHint")}</div>}
              {history.res?.output?.ok && logVerified === null && <p className="note">{t("vault.checking")}</p>}
              {logVerified === false && <p className="note" data-testid="vault-log-hidden">{t("vault.hiddenLog")}</p>}
              {logVerified === true && <p><span className="vbadge ok" data-testid="vault-verified"><i />{t("vault.verified")}</span></p>}
              {logVerified === true && entries && entries.length === 0 && <div className="vempty">{t("vault.empty")}</div>}
              {logVerified === true && entries && entries.length > 0 && (
                <div>
                  {[...entries].reverse().slice(0, 8).map((e, i) => (
                    <div className="av" key={i}>
                      <span className="op">{e.kind || "—"}</span>
                      <span style={{ overflowWrap: "anywhere" }}>{e.token_in ? `${e.amount_in ?? ""} ${e.token_in} → ${e.amount_out ?? ""} ${e.token_out ?? ""}` : `${e.amount ?? ""} ${e.token ?? ""}`}</span>
                      <span className="mono" style={{ color: "var(--mu)", fontSize: 13 }}>{e.ts_ms ? new Date(e.ts_ms).toLocaleString() : ""}</span>
                    </div>
                  ))}
                </div>
              )}
              {history.res?.error && <ErrorBox code={history.res.error.code} retryAfter={history.res.error.retry_after} />}
              <div className="vact" style={{ marginTop: 12 }}>
                <button className="vbtn sec" disabled={pnl.busy} data-testid="pnl-btn" onClick={() => { clearOtherErrors(pnl); void pnl.run({}); }}>{pnl.busy ? <Busy l={pnl.label} /> : t("vault.pnlBtn")}</button>
              </div>
              <p className="vhelp">{t("vault.pnlHelp")}</p>
              {pnl.res?.output && (pnl.res.output as { statement?: string }).statement && (() => {
                const o = pnl.res!.output as { statement: string; sig: string; minter: string };
                const href = `/pnl#${encodeShare({ statement: o.statement, sig: o.sig, minter: o.minter, call_id: pnl.res!.call_id })}`;
                return <p className="vhelp" data-testid="pnl-link"><Link href={href}>{t("vault.pnlOpen")}</Link></p>;
              })()}
              {pnl.res?.error && <ErrorBox code={pnl.res.error.code} retryAfter={pnl.res.error.retry_after} />}
              {history.res && <Attested r={history.res} />}
            </section>
          </div>
        </div>
        <HowStrip active={2} />
        </>
      )}
      {!accountId && <MetaMaskNote />}
    </div>
  );
}
