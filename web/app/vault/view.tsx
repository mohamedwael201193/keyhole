"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Attested, ErrorBox, OfflineState, capFrom } from "@/components/Result";
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
import { useHealth } from "@/lib/useHealth";
import { ASSETS, toBaseUnits, type AssetKey } from "@/lib/assets";
import { fundParams, swapParams, withdrawParams } from "@/lib/trade";
import { keyState, nftTier, shortAccount, tierName, tokensFor, type Token } from "@/lib/near";
import { attestation, intentTx, KEYS_CONTRACT, WORKER_WASM_SHA256 } from "@/lib/config";
import { assetRows, formatUsdMicro, isImplicitAccount, totalOf, tradeSummary, withdrawSummary, type PriceBook } from "@/lib/amount";
import { OP_CTX, type OpResume } from "@/lib/wallet";
import { copyText } from "@/lib/copyText";
import { publishedBuild, staticChecks, type Attestation } from "@/lib/verify";
import { CAPS, keyIdentity, serialOf, type Finish } from "@/lib/traits";
import { traitLabel } from "@/components/KeyCard";
import { KeyLog } from "@/components/KeyLog";

type Bal = { token?: string; symbol?: string; amount?: string; balance?: string; usd?: number; usd_micro?: number };
type Hist = { ts_ms?: number; kind?: string; token_in?: string; token_out?: string; amount_in?: string; amount_out?: string; usd_in_micro?: number; token?: string; amount?: string; chain?: string; status?: string };

export function VaultView({ initialOnline, initialPrices = {} }: { initialOnline: boolean; initialPrices?: PriceBook }) {
  const { t, fmtUsd } = useI18n();
  const { accountId, connect, pending } = useWallet();
  const online = useHealth(initialOnline);
  const status = useSigned("status");
  const quote = useSigned("quote");
  const account = useSigned("account");
  const balance = useSigned("balance");
  const history = useSigned("history");
  const swap = useSigned("swap");
  const withdraw = useSigned("withdraw");
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
  const [doneTrade, setDoneTrade] = useState<{ give: string; decimals: number; symbol: string } | null>(null);
  const [doneWithdraw, setDoneWithdraw] = useState<{ amount: string; to: string } | null>(null);
  const [prices, setPrices] = useState(initialPrices);
  const units = toBaseUnits(amount, ASSETS[from].decimals);
  const fundUnits = toBaseUnits(fundAmt, ASSETS[fundAsset].decimals);
  const wUnits = toBaseUnits(wAmt, ASSETS[wAsset].decimals);
  const tradeKey = `${from}:${toKey}:${units ?? ""}`;
  const utcReset = (() => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); })();
  useEffect(() => {
    if (!accountId) { setHeld(null); setKeysFor(null); setKeysReady(false); return; }
    let cancel = false;
    setKeysFor(accountId);
    setKeysReady(false);
    setHeld(null);
    tokensFor(accountId).then(async (toks) => {
      const token = toks[0];
      if (!token || cancel) { if (!cancel) { setHeld(null); setKeysReady(true); } return; }
      const tier = await nftTier(token.token_id).catch(() => null);
      if (!cancel) { setHeld({ token, tier }); setKeysReady(true); }
    }).catch(() => { if (!cancel) { setHeld(null); setKeysReady(true); } });
    return () => { cancel = true; };
  }, [accountId]);

  const quoteKey = useRef("");
  useEffect(() => {
    if (!quote.res) return;
    if (!quote.res.output?.ok) { setQuoted(null); return; }
    const min = quote.res.output.quote?.minAmountOut;
    setQuoted({ key: quoteKey.current, minOut: typeof min === "string" && /^\d+$/.test(min) ? min : undefined });
  }, [quote.res]);
  const s = status.res?.output;
  const q = quote.res?.output;
  const tierNum = (s?.ok ? Number(s.tier) : held?.tier) || null;
  const finish: Finish = tierNum === 3 ? "Gold" : tierNum === 2 ? "Silver" : "Bronze";
  const caps = s?.ok ? s.limits : null;
  const perCap = caps ? caps.per_tx_usd_micro : CAPS[finish].perTx * 1e6;
  const dayCap = caps ? caps.daily_usd_micro : CAPS[finish].daily * 1e6;
  const spent = s?.ok ? s.spent_today_usd_micro : null;
  const idn = held ? keyIdentity(held.token.token_id, held.tier) : null;
  const balances = (balance.res?.output?.ok ? balance.res.output.balances as Bal[] : null);
  const rows = balances ? assetRows(balances, prices) : null;
  const totalKind = totalOf(rows);
  const entries = (history.res?.output?.ok ? history.res.output.entries as Hist[] : null);
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
  const clearOtherErrors = (keep: { clear: () => void }) => {
    for (const card of [status, quote, account, balance, history, swap, withdraw]) if (card !== keep) card.clear();
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
    if (!out?.ok || out.op !== "swap") return;
    void readBalance({}, { quiet: true });
  }, [swap.res, readBalance]);
  useEffect(() => {
    const out = withdraw.res?.output;
    if (!out?.ok || out.op !== "withdraw") return;
    void readBalance({}, { quiet: true });
  }, [withdraw.res, readBalance]);

  return (
    <div className="page">
      <div className="top">
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
        {online === true && <span className="chip"><i />{t("vault.live", { hash: WORKER_WASM_SHA256[0].slice(0, 8) })}</span>}
        {online === null && <span className="chip wait" data-testid="enclave-checking"><i />{t("vault.checking")}</span>}
      </div>
      {online === false ? (
        <div><OfflineState /><HowStrip /></div>
      ) : !accountId ? (
        <div>
          <EmptyState title={t("empty.vaultTitle")} body={t("empty.vaultBody")} testid="vault-empty">
            <button className="btn b1" onClick={connect} data-testid="vault-connect">{t("nav.connect")}</button>
            <Link className="btn b2" href="/mint">{t("mint.title")}</Link>
          </EmptyState>
          <HowStrip active={1} />
        </div>
      ) : (
        <>
          <div className="vault-grid">
            <div className="c">
              <p className="lb">{t("vault.yourKey")}</p>
              {lookingUpKey ? <p className="note" data-testid="key-loading">{t("vault.keyLoading")}</p> : idn && held ? (
                <>
                  <div className="vault-key">
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
                      <h3 style={{ overflowWrap: "anywhere" }}>{t("gallery.key", { id: held.token.token_id })}</h3>
                      <div className="meta"><span>{KEYS_CONTRACT}</span></div>
                    </FoilCard>
                    <p className="att">{t("land.attested")}</p>
                  </div>
                  <dl className="kv" data-testid="vault-traits">
                    <dt>{t("field.head")}</dt><dd>{traitLabel(t, idn.head)}</dd>
                    <dt>{t("field.filigree")}</dt><dd>{traitLabel(t, idn.filigree)}</dd>
                    <dt>{t("field.enamel")}</dt><dd>{traitLabel(t, idn.enamel)}</dd>
                    <dt>{t("field.gem")}</dt><dd>{traitLabel(t, idn.gem)}</dd>
                    <dt>{t("field.cipher")}</dt><dd><Cipher bits={idn.bits} /></dd>
                    <dt>{t("proof.contract")}</dt><dd className="mono">{KEYS_CONTRACT}</dd>
                  </dl>
                  <p className="mono" style={{ fontSize: 12, color: "var(--mu)", marginTop: 8 }} data-state={keyState(held.token, held.tier, accountId)}>{t(`gallery.${keyState(held.token, held.tier, accountId)}`)}</p>
                  <KeyLog tokenId={held.token.token_id} />
                </>
              ) : (
                <EmptyState title={t("vault.nokey")} body={t("empty.mintBody")}>
                  <Link className="btn b1" href="/mint">{t("vault.mintFirst")}</Link>
                </EmptyState>
              )}
              <p className="lb" style={{ marginTop: 26 }}>{t("vault.limitsLabel", { tier: t(`finish.${finish}`) })}</p>
              {s?.ok ? (
                <>
                  <div className="bar"><span>{t("vault.perTx")}</span><span>{t("vault.ofCap", { used: fmtUsd(q?.ok ? q.usd_micro : 0), cap: fmtUsd(perCap) })}</span></div>
                  <div className="tr"><i style={{ width: `${Math.min(100, ((q?.ok ? q.usd_micro : 0) / perCap) * 100)}%` }} /></div>
                  <div className="bar"><span>{t("vault.today")}</span><span>{t("vault.ofCap", { used: fmtUsd(spent ?? 0), cap: fmtUsd(dayCap) })}</span></div>
                  <div className="tr"><i style={{ width: `${Math.min(100, ((spent ?? 0) / dayCap) * 100)}%` }} /></div>
                </>
              ) : <p className="note">{t("vault.limitsUnread")}</p>}
              <button className="btn b2" style={{ marginTop: 16 }} disabled={status.busy} onClick={() => { clearOtherErrors(status); void status.run({}); }} data-testid="status-btn">{status.busy ? "…" : t("vault.status")}</button>
              <p className="note">{t("vault.utc", { time: utcReset })} · {tierName(tierNum === 3 ? 3 : tierNum === 2 ? 2 : tierNum === 1 ? 1 : null)}</p>
              {status.res?.error && <ErrorBox code={status.res.error.code} retryAfter={status.res.error.retry_after} vars={{ cap: capFrom(status.res.error.message) }} />}
              {status.res?.error?.code === "no_key" && <Link className="btn b2" style={{ marginTop: 12 }} href="/mint">{t("vault.mintFirst")}</Link>}
              {status.res && <Attested r={status.res} />}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div className="c">
                <p className="lb">{t("vault.total")}</p>
                <p className="big" data-testid="vault-total">{totalKind.kind === "unread" ? "—" : totalKind.kind === "empty" ? formatUsdMicro(0) : totalKind.kind === "amounts" ? totalKind.text : formatUsdMicro(totalKind.micro)}</p>
                {totalKind.kind === "partial" && <p className="note" data-testid="unpriced">{t("vault.unpriced", { amounts: totalKind.unpriced.join(" · ") })}</p>}
                <p className="note">{balances ? t("vault.balanceReal") : t("vault.sealedBook")}</p>
                <div className="hero-actions" style={{ marginTop: 16 }}>
                  <button className="btn b1" disabled={balance.busy} onClick={() => { clearOtherErrors(balance); void balance.run({}); }} data-testid="balance-btn">{balance.busy ? "…" : t("vault.balance")}</button>
                  <button className="btn b2" disabled={account.busy} onClick={() => { clearOtherErrors(account); void account.run({}); }} data-testid="account-btn">{account.busy ? "…" : t("vault.open")}</button>
                </div>
                {account.res?.output?.ok && (
                  <p className="acct-line" data-testid="confidential-id">
                    <span className="lb" style={{ margin: 0 }}>{t("vault.sendTo")}</span>
                    <span className="id">{String(account.res.output.confidential_id)}</span>
                    <button type="button" onClick={() => { const id = String(account.res?.output?.confidential_id ?? ""); void copyText(id).then(() => { setCopiedConf(true); window.setTimeout(() => setCopiedConf(false), 1600); }); }}>{copiedConf ? t("nav.copied") : t("nav.copy")}</button>
                  </p>
                )}
                {balance.res?.error && <ErrorBox code={balance.res.error.code} retryAfter={balance.res.error.retry_after} />}
                {balance.res && <Attested r={balance.res} />}
              </div>
              <div className="stepper" role="tablist">
                {([1, 2, 3] as const).map((n) => (
                  <button key={n} type="button" role="tab" aria-selected={step === n} className={step === n ? "on" : ""} onClick={() => setStep(n)}>{t(n === 1 ? "vault.stepFund" : n === 2 ? "vault.stepTrade" : "vault.stepWithdraw")}</button>
                ))}
              </div>
              <div className="flow">
                {step === 1 && <section className="flow-step">
                  <p className="note">{t("vault.fundLead")}</p>
                  <div className="field">
                    <label htmlFor="fund-asset">{t("vault.from")}</label>
                    <TokenPick id="fund-asset" value={fundAsset} onChange={setFundAsset} />
                    <label htmlFor="fund-amt">{t("vault.amount")} ({ASSETS[fundAsset].symbol})</label>
                    <input id="fund-amt" inputMode="decimal" className="input" value={fundAmt} onChange={(e) => setFundAmt(e.target.value)} aria-invalid={!fundUnits} />
                    <button className="btn b1" type="button" disabled={!fundUnits || account.busy} data-testid="fund-btn" onClick={() => { if (fundUnits && accountId) { clearOtherErrors(account); void account.run(fundParams(fundAsset, fundUnits)); } }}>{account.busy ? "…" : t("vault.fundBtn")}</button>
                  </div>
                  {account.res?.output?.ok && typeof account.res.output.deposit?.deposit_address === "string" && (
                    <div data-testid="deposit" style={{ marginTop: 14 }}>
                      <p className="lb">{t("vault.deposit")}</p>
                      <p className="addr">{String(account.res.output.deposit.deposit_address)}</p>
                      {typeof account.res.output.deposit.hint === "string" && <p className="note">{String(account.res.output.deposit.hint)}</p>}
                      {typeof account.res.output.deposit.expires_at === "string" && <p className="note">{t("vault.expires", { time: String(account.res.output.deposit.expires_at) })}</p>}
                    </div>
                  )}
                  {account.res?.output?.ok && <p className="note" style={{ marginTop: 10 }}>{t("vault.sendTo")}: {String(account.res.output.confidential_id)}</p>}
                  {account.res?.error && <ErrorBox code={account.res.error.code} retryAfter={account.res.error.retry_after} />}
                  {account.res && <Attested r={account.res} />}
                </section>}
                {step === 2 && <section className="flow-step">
                  <p className="note">{t("vault.tradeLead")}</p>
                  <p className="note" data-testid="caps">{t("vault.capsLine", { finish: t(`finish.${finish}`), tx: fmtUsd(perCap), day: fmtUsd(dayCap) })}</p>
                  <form onSubmit={(e) => { e.preventDefault(); if (!units || !accountId || from === toKey) return; quoteKey.current = tradeKey; clearOtherErrors(quote); swap.reset(); void quote.run({ origin_asset: ASSETS[from].id, destination_asset: ASSETS[toKey].id, amount: units, refund_to: accountId, recipient: accountId, refund_type: "INTENTS", recipient_type: "INTENTS", deposit_type: "INTENTS", confidentiality: "basic", execute: false }); }}>
                    <div className="swap">
                      <div className="swap-row">
                        <div>
                          <label htmlFor="from">{t("vault.from")}</label>
                          <TokenPick id="from" value={from} onChange={setFrom} />
                        </div>
                        <input id="amt" className="swap-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!units} aria-label={t("vault.amount")} />
                      </div>
                      <button type="button" className="swap-flip" aria-label={t("vault.flip")} onClick={() => { const next = from; setFrom(toKey); setToKey(next); }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8h14M14 4l4 4-4 4" /><path d="M21 16H7M10 12l-4 4 4 4" /></svg>
                      </button>
                      <div className="swap-row">
                        <div>
                          <label htmlFor="to">{t("vault.to")}</label>
                          <TokenPick id="to" value={toKey} onChange={setToKey} />
                        </div>
                        <p className="swap-amt out">{q?.ok && quoted?.key === tradeKey ? Number(q.quote?.amountOutFormatted).toPrecision(4) : "—"}</p>
                      </div>
                    </div>
                    {from === toKey && <p className="note">{t("vault.same")}</p>}
                    <button className="btn b2" style={{ marginTop: 14 }} disabled={!units || from === toKey || quote.busy} data-testid="quote-btn">{quote.busy ? "…" : t("vault.get")}</button>
                  </form>
                  {q?.ok && quoted?.key === tradeKey && (
                    <div className="receipt" data-testid="quote">
                      <div className="row"><span>{t("vault.give")}</span><span>{amount} {ASSETS[from].symbol}</span></div>
                      <div className="row"><span>{t("vault.youGet")}</span><span>{Number(q.quote?.amountOutFormatted).toPrecision(6)} {ASSETS[toKey].symbol}</span></div>
                      <div className="row"><span>{t("vault.price")}</span><span>{fmtUsd(q.usd_micro)}</span></div>
                      <div className="row"><span>{t("vault.capUsed")}</span><span>{t("vault.ofCap", { used: fmtUsd(q.usd_micro), cap: fmtUsd(perCap) })}</span></div>
                      <div className="tr"><i style={{ width: `${Math.min(100, (q.usd_micro / perCap) * 100)}%` }} /></div>
                    </div>
                  )}
                  <button className="btn b1" style={{ marginTop: 14 }} type="button" data-testid="trade-btn" disabled={!units || from === toKey || quoted?.key !== tradeKey || swap.busy} onClick={() => { if (!units || !quoted || quoted.key !== tradeKey) return; const ctx: OpResume = { op: "swap", give: `${amount} ${ASSETS[from].symbol}`, decimals: ASSETS[toKey].decimals, symbol: ASSETS[toKey].symbol }; sessionStorage.setItem(OP_CTX, JSON.stringify(ctx)); setDoneTrade(ctx); clearOtherErrors(swap); void swap.run(swapParams(from, toKey, units, quoted.minOut)); }}>{swap.busy ? "…" : t("vault.signTrade")}</button>
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
                </section>}
                {step === 3 && <section className="flow-step">
                  <p className="note">{t("vault.withdrawLead", { account: accountId })}</p>
                  <div className="field">
                    <label htmlFor="w-asset">{t("vault.from")}</label>
                    <TokenPick id="w-asset" value={wAsset} onChange={setWAsset} />
                    <label htmlFor="w-amt">{t("vault.amount")} ({ASSETS[wAsset].symbol})</label>
                    <input id="w-amt" inputMode="decimal" className="input" value={wAmt} onChange={(e) => setWAmt(e.target.value)} aria-invalid={!wUnits} />
                    <button className="btn b1" type="button" data-testid="withdraw-btn" disabled={!wUnits || withdraw.busy} onClick={() => { if (wUnits && accountId) { const ctx: OpResume = { op: "withdraw", amount: `${wAmt} ${ASSETS[wAsset].symbol}`, to: shortAccount(accountId) }; sessionStorage.setItem(OP_CTX, JSON.stringify(ctx)); setDoneWithdraw(ctx); clearOtherErrors(withdraw); void withdraw.run(withdrawParams(accountId, wAsset, wUnits)); } }}>{withdraw.busy ? "…" : t("vault.withdrawBtn")}</button>
                  </div>
                  {withdraw.res?.output?.ok && withdraw.res.output.op === "withdraw" && doneWithdraw && (
                    <div className="result-card" data-testid="withdraw-out">
                      <b>{withdrawSummary(doneWithdraw.amount, doneWithdraw.to)}</b>
                      <p className="note">{String(withdraw.res.output.status ?? "")}</p>
                      {withdraw.res.output.request_id && <p className="mono" style={{ fontSize: 13 }}>{t("vault.request")} {String(withdraw.res.output.request_id)}</p>}
                      <p className="mono" style={{ fontSize: 13 }} data-testid="withdraw-receipt">{t("vault.to")}: {String(withdraw.res.output.to ?? doneWithdraw.to)} · {t("vault.amount")}: {String(withdraw.res.output.amount ?? "")} · {t("vault.txHash")}: {withdraw.res.output.tx_hash ? String(withdraw.res.output.tx_hash) : "—"} · {t("vault.fee")}: {withdraw.res.output.fee ? String(withdraw.res.output.fee) : "—"}</p>
                      {isImplicitAccount(accountId || "") && <p className="note">{t("vault.storageNote")}</p>}
                    </div>
                  )}
                  {withdraw.res?.error && <ErrorBox code={withdraw.res.error.code} retryAfter={withdraw.res.error.retry_after} vars={{ cap: capFrom(withdraw.res.error.message) }} />}
                  {withdraw.res && <Attested r={withdraw.res} />}
                </section>}
              </div>
              <div className="c">
                <p className="lb">{t("vault.activity")}</p>
                <button className="btn b2" disabled={history.busy} onClick={() => { clearOtherErrors(history); void history.run({}); }}>{history.busy ? "…" : t("vault.history")}</button>
                {history.res?.output?.ok && logVerified === null && <p className="note">{t("vault.checking")}</p>}
                {logVerified === false && <p className="note" data-testid="vault-log-hidden">{t("vault.hiddenLog")}</p>}
                {logVerified === true && <p className="note" data-testid="vault-verified">{t("vault.verified")}</p>}
                {logVerified === true && entries && entries.length === 0 && <p className="note">{t("vault.empty")}</p>}
                {logVerified === true && entries && [...entries].reverse().slice(0, 8).map((e, i) => (
                  <div className="av" key={i}>
                    <span className="op">{e.kind || "—"}</span>
                    <span>{e.token_in ? `${e.amount_in ?? ""} ${e.token_in} → ${e.amount_out ?? ""} ${e.token_out ?? ""}` : `${e.amount ?? ""} ${e.token ?? ""}`}</span>
                    <span className="mono" style={{ color: "var(--mu)", fontSize: 13 }}>{e.ts_ms ? new Date(e.ts_ms).toLocaleString() : ""}</span>
                    <span className="att">{t("vault.verified")}</span>
                  </div>
                ))}
                {history.res?.error && <ErrorBox code={history.res.error.code} retryAfter={history.res.error.retry_after} />}
                {history.res && <Attested r={history.res} />}
              </div>
            </div>
          </div>
          <div className="c" style={{ marginTop: 22 }}>
            <p className="lb">{t("vault.assets", { n: balances?.length ?? 0 })}</p>
            {!balances && <p className="note">{t("vault.sealedBook")}</p>}
            {balances && balances.length === 0 && <p className="note">{t("vault.empty")}</p>}
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
          <HowStrip active={2} />
        </>
      )}
    </div>
  );
}
