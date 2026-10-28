"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
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
import { KEYS_CONTRACT, WORKER_WASM_SHA256 } from "@/lib/config";
import { CAPS, FINISH_COLOR, keyIdentity, type Finish } from "@/lib/traits";
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
  const [from, setFrom] = useState<AssetKey>("usdc");
  const [amount, setAmount] = useState("0.05");
  const [panel, setPanel] = useState<"quote" | "swap" | "copy" | "withdraw" | null>("quote");
  const [held, setHeld] = useState<{ token: Token; tier: number | null } | null>(null);
  const to: AssetKey = from === "usdc" ? "wnear" : "usdc";
  const units = toBaseUnits(amount, ASSETS[from].decimals);
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
                  <FoilCard finish={idn.finish} className="nft-art">
                    <span className="tier" style={{ background: FINISH_COLOR[idn.finish] }}>{t(`finish.${idn.finish}`)}</span>
                    <span className="att">{t("land.attested")}</span>
                    <KeyArt n={idn.art} alt={held.token.token_id} width={433} height={1080} />
                  </FoilCard>
                  <h2 style={{ fontSize: 36, margin: "18px 0 6px", overflowWrap: "anywhere" }}>{t("gallery.key", { id: held.token.token_id })}</h2>
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
                {account.res?.error && <ErrorBox code={account.res.error.code} retryAfter={account.res.error.retry_after} />}
                {balance.res && <Attested r={balance.res} />}
                {account.res && <Attested r={account.res} />}
              </div>
              <div className="acts">
                {([
                  ["quote", "p", 5, "vault.quote", "vault.quoteD"],
                  ["swap", "", 2, "vault.swap", "vault.swapD"],
                  ["copy", "", 3, "vault.copy", "vault.copyD"],
                  ["withdraw", "", 1, "vault.withdraw", "vault.withdrawD"],
                ] as const).map(([id, p, icon, title, sub]) => (
                  <button key={id} className={`act ${panel === id ? "p" : p}`} onClick={() => setPanel(id)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/heirloom/icons/icon${icon}.webp`} alt="" width={54} height={54} />
                    <div><b>{t(title)}</b><small>{t(sub)}</small></div>
                  </button>
                ))}
              </div>
              <div className="c">
                {panel === "quote" && (
                  <form onSubmit={(e) => { e.preventDefault(); if (units && accountId) void quote.run({ origin_asset: ASSETS[from].id, destination_asset: ASSETS[to].id, amount: units, refund_to: accountId, recipient: accountId, refund_type: "INTENTS", recipient_type: "INTENTS", deposit_type: "INTENTS", confidentiality: "basic", execute: false }); }}>
                    <p className="lb">{t("vault.quote")}</p>
                    <div className="field">
                      <label htmlFor="from">{t("vault.from")}</label>
                      <select id="from" className="input" value={from} onChange={(e) => setFrom(e.target.value as AssetKey)}>
                        {Object.entries(ASSETS).map(([k, a]) => <option key={k} value={k}>{a.symbol}</option>)}
                      </select>
                      <label htmlFor="amt">{t("vault.amount")} ({ASSETS[from].symbol})</label>
                      <input id="amt" inputMode="decimal" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!units} />
                      <p className="note">{t("vault.to")}: {ASSETS[to].symbol}</p>
                      <button className="btn b1" disabled={!units || quote.busy} data-testid="quote-btn">{quote.busy ? "…" : t("vault.get")}</button>
                    </div>
                    <p className="note">{t("vault.dry")}</p>
                    {q?.ok && (
                      <dl className="kv" style={{ marginTop: 16 }} data-testid="quote">
                        <dt>{t("vault.out")}</dt><dd>{Number(q.quote?.amountOutFormatted).toPrecision(6)} {ASSETS[to].symbol}</dd>
                        <dt>{t("vault.usd")}</dt><dd>{fmtUsd(q.usd_micro)}</dd>
                        <dt>{t("vault.policy")}</dt><dd>{String(q.policy)}</dd>
                      </dl>
                    )}
                    {quote.res?.error && <ErrorBox code={quote.res.error.code} retryAfter={quote.res.error.retry_after} vars={{ cap: capFrom(quote.res.error.message) }} />}
                    {quote.res && <Attested r={quote.res} />}
                  </form>
                )}
                {panel && panel !== "quote" && <div><p className="lb">{t(`vault.${panel}`)}</p><p>{t("vault.cliNote")}</p></div>}
                <p className="lb" style={{ marginTop: 22 }}>{t("vault.activity")}</p>
                <button className="btn b2" disabled={history.busy} onClick={() => void history.run({})}>{history.busy ? "…" : t("vault.history")}</button>
                {entries && entries.length === 0 && <p className="note">{t("vault.empty")}</p>}
                {entries && [...entries].reverse().slice(0, 8).map((e, i) => (
                  <div className="av" key={i}>
                    <span className="op">{e.kind || "—"}</span>
                    <span>{e.token_in ? `${e.amount_in ?? ""} ${e.token_in} → ${e.amount_out ?? ""} ${e.token_out ?? ""}` : `${e.amount ?? ""} ${e.token ?? ""}`}</span>
                    <span className="mono" style={{ color: "var(--mu)", fontSize: 13 }}>{e.ts_ms ? new Date(e.ts_ms).toLocaleString() : ""}</span>
                    <span className="att">{t("land.attested")}</span>
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
