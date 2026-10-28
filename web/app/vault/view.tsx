"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Attested, ErrorBox, OfflineState, capFrom } from "@/components/Result";
import { HowStrip } from "@/components/HowStrip";
import { EmptyState } from "@/components/EmptyState";
import { Cipher } from "@/components/Cipher";
import { KeyArt } from "@/components/Art";
import { FoilCard } from "@/components/FoilCard";
import { Medal } from "@/components/Medal";
import { useI18n } from "@/lib/i18n";
import { useWallet } from "@/lib/wallet";
import { useSigned } from "@/lib/useSigned";
import { useHealth } from "@/lib/useHealth";
import { ASSETS, toBaseUnits, type AssetKey } from "@/lib/assets";
import { keyState, nftTier, shortAccount, tierName, tokensFor, type Token } from "@/lib/near";
import { attestation, KEYS_CONTRACT, WORKER_WASM_SHA256 } from "@/lib/config";
import { publishedBuild, staticChecks, type Attestation } from "@/lib/verify";
import { CAPS, keyIdentity, type Finish } from "@/lib/traits";
import { traitLabel } from "@/components/KeyCard";

const LOGO: Record<string, [string, string]> = {
  NEAR: ["near", "NEAR"], WNEAR: ["near", "NEAR"], USDC: ["usdc", "USDC"], ETH: ["eth", "ETH"],
  SOL: ["sol", "SOL"], BTC: ["btc", "BTC"], ZEC: ["zec", "ZEC"], ARB: ["arb", "ARB"], BASE: ["base", "Base"],
};

type Bal = { token?: string; symbol?: string; amount?: string; balance?: string; usd?: number; usd_micro?: number };
type Hist = { ts_ms?: number; kind?: string; token_in?: string; token_out?: string; amount_in?: string; amount_out?: string; usd_in_micro?: number; token?: string; amount?: string; chain?: string; status?: string };

export function VaultView({ initialOnline }: { initialOnline: boolean }) {
  const { t, fmtUsd } = useI18n();
  const { accountId, connect } = useWallet();
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
  const [held, setHeld] = useState<{ token: Token; tier: number | null } | null>(null);
  const units = toBaseUnits(amount, ASSETS[from].decimals);
  const fundUnits = toBaseUnits(fundAmt, ASSETS[fundAsset].decimals);
  const wUnits = toBaseUnits(wAmt, ASSETS[wAsset].decimals);
  const tradeKey = `${from}:${toKey}:${units ?? ""}`;
  const utcReset = (() => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); })();
  useEffect(() => {
    if (!accountId) { setHeld(null); return; }
    let cancel = false;
    tokensFor(accountId).then(async (toks) => {
      const token = toks[0];
      if (!token || cancel) { if (!cancel) setHeld(null); return; }
      const tier = await nftTier(token.token_id).catch(() => null);
      if (!cancel) setHeld({ token, tier });
    }).catch(() => { if (!cancel) setHeld(null); });
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
  const entries = (history.res?.output?.ok ? history.res.output.entries as Hist[] : null);
  const [logVerified, setLogVerified] = useState<boolean | null>(null);
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
  const usdOf = (b: Bal) => typeof b.usd === "number" ? b.usd : typeof b.usd_micro === "number" ? b.usd_micro / 1e6 : null;
  const total = balances && balances.length && balances.every((b) => usdOf(b) != null) ? balances.reduce((a, b) => a + (usdOf(b) || 0), 0) : null;

  return (
    <div className="page">
      <div className="top">
        <div>
          <p className="eb">{accountId ? t("vault.eyebrow", { account: shortAccount(accountId) }) : t("vault.eyebrowOff")}</p>
          <h1>{t("vault.title")}</h1>
        </div>
        {online && <span className="chip"><i />{t("vault.live", { hash: WORKER_WASM_SHA256[0].slice(0, 8) })}</span>}
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
              {idn && held ? (
                <>
                  <div className="vault-key">
                    <FoilCard finish={idn.finish}>
                      <div className="top">
                        <span className="tier">{t(`finish.${idn.finish}`)}</span>
                        <span className="oo">{t("land.oneOfOne")}</span>
                      </div>
                      <div className="art"><KeyArt n={idn.art} alt={held.token.token_id} width={433} height={1080} /></div>
                      <h3 style={{ overflowWrap: "anywhere" }}>{t("gallery.key", { id: held.token.token_id })}</h3>
                      <div className="meta"><span>{KEYS_CONTRACT}</span></div>
                    </FoilCard>
                    <p className="att">{t("land.attested")}</p>
                  </div>
                  <dl className="kv">
                    <dt>{t("field.head")}</dt><dd>{traitLabel(t, idn.head)}</dd>
                    <dt>{t("field.filigree")}</dt><dd>{traitLabel(t, idn.filigree)}</dd>
                    <dt>{t("field.enamel")}</dt><dd>{traitLabel(t, idn.enamel)}</dd>
                    <dt>{t("field.gem")}</dt><dd>{traitLabel(t, idn.gem)}</dd>
                    <dt>{t("field.cipher")}</dt><dd><Cipher bits={idn.bits} /></dd>
                    <dt>{t("proof.contract")}</dt><dd>{KEYS_CONTRACT}</dd>
                  </dl>
                  <p className="mono" style={{ fontSize: 12, color: "var(--mu)", marginTop: 8 }} data-state={keyState(held.token, held.tier, accountId)}>{t(`gallery.${keyState(held.token, held.tier, accountId)}`)}</p>
                </>
              ) : (
                <EmptyState title={t("vault.nokey")} body={t("empty.mintBody")}>
                  <Link className="btn b1" href="/mint">{t("vault.mintFirst")}</Link>
                </EmptyState>
              )}
              <p className="lb" style={{ marginTop: 26 }}>{t("vault.limitsLabel", { tier: t(`finish.${finish}`) })}</p>
              <div className="bar"><span>{t("vault.perTx")}</span><span>{q?.ok ? `${fmtUsd(q.usd_micro)} / ${fmtUsd(perCap)}` : `— / ${fmtUsd(perCap)}`}</span></div>
              <div className="tr"><i style={{ width: q?.ok ? `${Math.min(100, (q.usd_micro / perCap) * 100)}%` : "0%" }} /></div>
              <div className="bar"><span>{t("vault.today")}</span><span>{spent == null ? `— / ${fmtUsd(dayCap)}` : `${fmtUsd(spent)} / ${fmtUsd(dayCap)}`}</span></div>
              <div className="tr"><i style={{ width: spent == null ? "0%" : `${Math.min(100, (spent / dayCap) * 100)}%` }} /></div>
              <button className="btn b2" style={{ marginTop: 16 }} disabled={status.busy} onClick={() => void status.run({})} data-testid="status-btn">{status.busy ? "…" : t("vault.status")}</button>
              <p className="note">{t("vault.utc", { time: utcReset })} · {tierName(tierNum === 3 ? 3 : tierNum === 2 ? 2 : tierNum === 1 ? 1 : null)}</p>
              {status.res?.error && <ErrorBox code={status.res.error.code} retryAfter={status.res.error.retry_after} vars={{ cap: capFrom(status.res.error.message) }} />}
              {status.res?.error?.code === "no_key" && <Link className="btn b2" style={{ marginTop: 12 }} href="/mint">{t("vault.mintFirst")}</Link>}
              {status.res && <Attested r={status.res} />}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div className="c">
                <p className="lb">{t("vault.total")}</p>
                <p className="big">{total == null ? "—" : <>${Math.floor(total).toLocaleString("en")}<small>.{total.toFixed(2).split(".")[1]}</small></>}</p>
                <p className="note">{balances ? t("vault.balanceReal") : t("vault.sealedBook")}</p>
                <div className="hero-actions" style={{ marginTop: 16 }}>
                  <button className="btn b1" disabled={balance.busy} onClick={() => void balance.run({})} data-testid="balance-btn">{balance.busy ? "…" : t("vault.balance")}</button>
                  <button className="btn b2" disabled={account.busy} onClick={() => void account.run({})} data-testid="account-btn">{account.busy ? "…" : t("vault.open")}</button>
                </div>
                {account.res?.output?.ok && <p className="mono" style={{ marginTop: 12, fontSize: 13 }} data-testid="confidential-id">{String(account.res.output.confidential_id)}</p>}
                {balance.res?.error && <ErrorBox code={balance.res.error.code} retryAfter={balance.res.error.retry_after} />}
                {balance.res && <Attested r={balance.res} />}
              </div>
              <div className="flow">
                <section className="flow-step">
                  <p className="n">{t("vault.stepFund")}</p>
                  <p className="note">{t("vault.fundLead")}</p>
                  <div className="field">
                    <label htmlFor="fund-asset">{t("vault.from")}</label>
                    <div className="pair">
                      <Medal id={ASSETS[fundAsset].logo} name={ASSETS[fundAsset].symbol} labeled={false} />
                      <select id="fund-asset" className="input" value={fundAsset} onChange={(e) => setFundAsset(e.target.value as AssetKey)}>
                        {Object.entries(ASSETS).map(([k, a]) => <option key={k} value={k}>{a.symbol}</option>)}
                      </select>
                    </div>
                    <label htmlFor="fund-amt">{t("vault.amount")} ({ASSETS[fundAsset].symbol})</label>
                    <input id="fund-amt" inputMode="decimal" className="input" value={fundAmt} onChange={(e) => setFundAmt(e.target.value)} aria-invalid={!fundUnits} />
                    <button className="btn b1" type="button" disabled={!fundUnits || account.busy} data-testid="fund-btn" onClick={() => { if (fundUnits && accountId) void account.run({ chain: "near", token: ASSETS[fundAsset].symbol, amount: fundUnits }); }}>{account.busy ? "…" : t("vault.fundBtn")}</button>
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
                </section>
                <section className="flow-step">
                  <p className="n">{t("vault.stepTrade")}</p>
                  <p className="note">{t("vault.tradeLead")}</p>
                  <p className="note" data-testid="caps">{t("vault.capsLine", { finish: t(`finish.${finish}`), tx: fmtUsd(perCap), day: fmtUsd(dayCap) })}</p>
                  <form onSubmit={(e) => { e.preventDefault(); if (!units || !accountId || from === toKey) return; quoteKey.current = tradeKey; void quote.run({ origin_asset: ASSETS[from].id, destination_asset: ASSETS[toKey].id, amount: units, refund_to: accountId, recipient: accountId, refund_type: "INTENTS", recipient_type: "INTENTS", deposit_type: "INTENTS", confidentiality: "basic", execute: false }); }}>
                    <div className="field">
                      <label htmlFor="from">{t("vault.from")}</label>
                      <div className="pair">
                        <Medal id={ASSETS[from].logo} name={ASSETS[from].symbol} labeled={false} />
                        <select id="from" className="input" value={from} onChange={(e) => setFrom(e.target.value as AssetKey)}>
                          {Object.entries(ASSETS).map(([k, a]) => <option key={k} value={k}>{a.symbol}</option>)}
                        </select>
                      </div>
                      <label htmlFor="to">{t("vault.to")}</label>
                      <div className="pair">
                        <Medal id={ASSETS[toKey].logo} name={ASSETS[toKey].symbol} labeled={false} />
                        <select id="to" className="input" value={toKey} onChange={(e) => setToKey(e.target.value as AssetKey)}>
                          {Object.entries(ASSETS).map(([k, a]) => <option key={k} value={k}>{a.symbol}</option>)}
                        </select>
                      </div>
                      <label htmlFor="amt">{t("vault.amount")} ({ASSETS[from].symbol})</label>
                      <input id="amt" inputMode="decimal" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!units} />
                      {from === toKey && <p className="note">{t("vault.same")}</p>}
                      <button className="btn b1" disabled={!units || from === toKey || quote.busy} data-testid="quote-btn">{quote.busy ? "…" : t("vault.get")}</button>
                    </div>
                  </form>
                  {q?.ok && quoted?.key === tradeKey && (
                    <dl className="kv" style={{ marginTop: 16 }} data-testid="quote">
                      <dt>{t("vault.out")}</dt><dd>{Number(q.quote?.amountOutFormatted).toPrecision(6)} {ASSETS[toKey].symbol}</dd>
                      <dt>{t("vault.usd")}</dt><dd>{fmtUsd(q.usd_micro)}</dd>
                      <dt>{t("vault.policy")}</dt><dd>{String(q.policy)}</dd>
                    </dl>
                  )}
                  <button className="btn b1" style={{ marginTop: 12 }} type="button" data-testid="trade-btn" disabled={!units || from === toKey || quoted?.key !== tradeKey || swap.busy} onClick={() => { if (!units || !quoted || quoted.key !== tradeKey) return; void swap.run({ token_in: ASSETS[from].id, token_out: ASSETS[toKey].id, amount_in: units, ...(quoted.minOut ? { min_amount_out: quoted.minOut } : {}) }); }}>{swap.busy ? "…" : t("vault.signTrade")}</button>
                  {quote.res?.error && <ErrorBox code={quote.res.error.code} retryAfter={quote.res.error.retry_after} vars={{ cap: capFrom(quote.res.error.message) }} />}
                  {swap.res?.error && <ErrorBox code={swap.res.error.code} retryAfter={swap.res.error.retry_after} vars={{ cap: capFrom(swap.res.error.message) }} />}
                  {swap.res?.output?.ok && <p className="note" data-testid="trade-out">{t("vault.out")}: {String(swap.res.output.amount_out ?? "")}</p>}
                  {quote.res && <Attested r={quote.res} />}
                  {swap.res && <Attested r={swap.res} />}
                </section>
                <section className="flow-step">
                  <p className="n">{t("vault.stepWithdraw")}</p>
                  <p className="note">{t("vault.withdrawLead", { account: accountId })}</p>
                  <div className="field">
                    <label htmlFor="w-asset">{t("vault.from")}</label>
                    <div className="pair">
                      <Medal id={ASSETS[wAsset].logo} name={ASSETS[wAsset].symbol} labeled={false} />
                      <select id="w-asset" className="input" value={wAsset} onChange={(e) => setWAsset(e.target.value as AssetKey)}>
                        {Object.entries(ASSETS).map(([k, a]) => <option key={k} value={k}>{a.symbol}</option>)}
                      </select>
                    </div>
                    <label htmlFor="w-amt">{t("vault.amount")} ({ASSETS[wAsset].symbol})</label>
                    <input id="w-amt" inputMode="decimal" className="input" value={wAmt} onChange={(e) => setWAmt(e.target.value)} aria-invalid={!wUnits} />
                    <button className="btn b1" type="button" data-testid="withdraw-btn" disabled={!wUnits || withdraw.busy} onClick={() => { if (wUnits && accountId) void withdraw.run({ chain: "near", to: accountId, token: ASSETS[wAsset].id, amount: wUnits }); }}>{withdraw.busy ? "…" : t("vault.withdrawBtn")}</button>
                  </div>
                  {withdraw.res?.error && <ErrorBox code={withdraw.res.error.code} retryAfter={withdraw.res.error.retry_after} vars={{ cap: capFrom(withdraw.res.error.message) }} />}
                  {withdraw.res && <Attested r={withdraw.res} />}
                </section>
              </div>
              <div className="c">
                <p className="lb">{t("vault.activity")}</p>
                <button className="btn b2" disabled={history.busy} onClick={() => void history.run({})}>{history.busy ? "…" : t("vault.history")}</button>
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
            {balances && balances.length > 0 && (
              <div className="assets">
                {balances.map((b, i) => {
                  const sym = (b.symbol || b.token || "").toUpperCase();
                  const logo = LOGO[sym] || LOGO[sym.replace(/^W/, "")] || null;
                  const usd = usdOf(b);
                  return (
                    <div className="arow" key={i}>
                      {logo ? <Medal id={logo[0]} name={logo[1]} /> : <span className="medal" />}
                      <div><b>{sym || "—"}</b><small>{b.amount ?? b.balance ?? ""}</small></div>
                      <span className="v">{usd == null ? "—" : fmtUsd(Math.round(usd * 1e6))}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <HowStrip active={2} />
        </>
      )}
    </div>
  );
}
