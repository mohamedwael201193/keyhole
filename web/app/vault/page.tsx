"use client";
import Link from "next/link";
import { useState } from "react";
import { PageHead } from "@/components/PageHead";
import { Attested, ErrorBox, capFrom } from "@/components/Result";
import { useI18n } from "@/lib/i18n";
import { useWallet } from "@/lib/wallet";
import { useSigned } from "@/lib/useSigned";
import { ASSETS, toBaseUnits, type AssetKey } from "@/lib/assets";
import { tierName } from "@/lib/near";

export default function Vault() {
  const { t, fmtUsd } = useI18n();
  const { accountId, connect } = useWallet();
  const status = useSigned("status");
  const quote = useSigned("quote");
  const account = useSigned("account");
  const balance = useSigned("balance");
  const history = useSigned("history");
  const [from, setFrom] = useState<AssetKey>("usdc");
  const [amount, setAmount] = useState("0.05");
  const to: AssetKey = from === "usdc" ? "wnear" : "usdc";
  const units = toBaseUnits(amount, ASSETS[from].decimals);
  const utcReset = (() => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); })();
  const s = status.res?.output; const q = quote.res?.output;
  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <PageHead eyebrow="TEE · Intel TDX" title={t("vault.title")} sub={t("vault.sub")} />
      {!accountId ? (
        <div className="plate p-8 text-center"><p className="text-zinc-300">{t("vault.need")}</p><button className="btn btn-signal mt-5" onClick={connect}>{t("nav.connect")}</button></div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="plate p-6" aria-labelledby="lim-h">
            <h2 id="lim-h" className="font-serif text-3xl">{t("vault.status")}</h2>
            <button className="btn btn-signal mt-4" disabled={status.busy} onClick={() => void status.run({})} data-testid="status-btn">{status.busy ? "…" : t("vault.status")}</button>
            {s && s.ok && (
              <dl className="mt-5 grid grid-cols-2 gap-3 font-mono text-sm" data-testid="limits">
                <dt className="label">{t("vault.tier")}</dt><dd>{tierName(s.tier)}</dd>
                <dt className="label">{t("vault.perTx")}</dt><dd>{fmtUsd(s.limits.per_tx_usd_micro)}</dd>
                <dt className="label">{t("vault.daily")}</dt><dd>{fmtUsd(s.limits.daily_usd_micro)}</dd>
                <dt className="label">{t("vault.spent")}</dt><dd>{fmtUsd(s.spent_today_usd_micro)}</dd>
                <dt className="label">{t("vault.perMin")}</dt><dd>{s.limits.per_minute_calls}</dd>
              </dl>
            )}
            <p className="mt-4 text-xs text-mute">{t("vault.utc", { time: utcReset })}</p>
            {status.res?.error && <div className="mt-4"><ErrorBox code={status.res.error.code} retryAfter={status.res.error.retry_after} vars={{ cap: capFrom(status.res.error.message) }} /></div>}
            {status.res?.error?.code === "no_key" && <Link className="btn btn-ghost mt-3" href="/mint">{t("vault.mintFirst")}</Link>}
            {status.res && <Attested r={status.res} />}
          </section>
          <section className="plate p-6" aria-labelledby="q-h">
            <h2 id="q-h" className="font-serif text-3xl">{t("vault.quote")}</h2>
            <form className="mt-4 grid gap-3" onSubmit={(e) => { e.preventDefault(); if (units) void quote.run({ origin_asset: ASSETS[from].id, destination_asset: ASSETS[to].id, amount: units, refund_to: accountId, recipient: accountId, refund_type: "INTENTS", recipient_type: "INTENTS", deposit_type: "INTENTS", confidentiality: "basic", execute: false }); }}>
              <label className="label" htmlFor="from">{t("vault.from")}</label>
              <select id="from" className="input" value={from} onChange={(e) => setFrom(e.target.value as AssetKey)}>
                {Object.entries(ASSETS).map(([k, a]) => <option key={k} value={k}>{a.symbol}</option>)}
              </select>
              <label className="label" htmlFor="amt">{t("vault.amount")} ({ASSETS[from].symbol})</label>
              <input id="amt" inputMode="decimal" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!units} />
              <p className="text-xs text-mute">{t("vault.to")}: {ASSETS[to].symbol}</p>
              <button className="btn btn-signal" disabled={!units || quote.busy} data-testid="quote-btn">{quote.busy ? "…" : t("vault.get")}</button>
            </form>
            <p className="mt-3 text-xs text-mute">{t("vault.dry")}</p>
            {q && q.ok && (
              <dl className="mt-5 grid grid-cols-2 gap-3 font-mono text-sm" data-testid="quote">
                <dt className="label">{t("vault.out")}</dt><dd>{Number(q.quote?.amountOutFormatted).toPrecision(6)} {ASSETS[to].symbol}</dd>
                <dt className="label">{t("vault.usd")}</dt><dd>{fmtUsd(q.usd_micro)}</dd>
                <dt className="label">{t("vault.policy")}</dt><dd className="text-signal">{q.policy}</dd>
              </dl>
            )}
            {quote.res?.error && <div className="mt-4"><ErrorBox code={quote.res.error.code} retryAfter={quote.res.error.retry_after} vars={{ cap: capFrom(quote.res.error.message) }} /></div>}
            {quote.res && <Attested r={quote.res} />}
          </section>
          <section className="plate p-6 lg:col-span-2" aria-labelledby="acc-h">
            <h2 id="acc-h" className="font-serif text-3xl">{t("vault.account")}</h2>
            <p className="mt-2 text-sm text-zinc-300">{t("vault.accountD")}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button className="btn btn-signal" disabled={account.busy} onClick={() => void account.run({})} data-testid="account-btn">{account.busy ? "…" : t("vault.open")}</button>
              <button className="btn btn-ghost" disabled={balance.busy} onClick={() => void balance.run({})} data-testid="balance-btn">{balance.busy ? "…" : t("vault.balance")}</button>
              <button className="btn btn-ghost" disabled={history.busy} onClick={() => void history.run({})}>{history.busy ? "…" : t("vault.history")}</button>
            </div>
            {account.res?.output?.ok && <p className="mt-4 break-all font-mono text-sm" data-testid="confidential-id"><span className="label me-2">confidential id</span>{String(account.res.output.confidential_id)}</p>}
            {balance.res?.output?.ok && (
              <ul className="mt-4 grid gap-1 font-mono text-sm" data-testid="balances">
                {(balance.res.output.balances as { token?: string; symbol?: string; amount?: string; balance?: string }[]).length === 0 && <li className="text-mute">0 · {t("vault.empty")}</li>}
                {(balance.res.output.balances as { token?: string; symbol?: string; amount?: string; balance?: string }[]).map((b, i) => <li key={i}>{b.symbol || b.token}: {b.amount ?? b.balance}</li>)}
              </ul>
            )}
            {history.res?.output?.ok && (
              <ol className="mt-4 grid gap-1 font-mono text-xs text-zinc-300">
                {(history.res.output.entries as unknown[]).length === 0 && <li className="text-mute">{t("vault.empty")}</li>}
                {(history.res.output.entries as unknown[]).slice(-20).map((e, i) => <li key={i} className="break-all">{JSON.stringify(e)}</li>)}
              </ol>
            )}
            {[account, balance, history].map((x, i) => x.res?.error ? <div key={i} className="mt-4"><ErrorBox code={x.res.error.code} retryAfter={x.res.error.retry_after} /></div> : null)}
            {[account, balance, history].map((x, i) => x.res ? <Attested key={i} r={x.res} /> : null)}
          </section>
        </div>
      )}
    </div>
  );
}
