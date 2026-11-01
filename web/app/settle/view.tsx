"use client";
import { Fragment, useEffect, useState } from "react";
import { OC_ASSETS, statusOf, toUnits, assetById } from "@/lib/oneclick";
import { SETTLEMENTS, RECORDED_FAILED, type Settlement } from "@/lib/settlements";
import { tx, intentTx } from "@/lib/config";

type Dry = { amountInFormatted: string; amountInUsd: string; amountOutFormatted: string; amountOutUsd: string; timeEstimate: number };
type St = { status: string; updatedAt?: string; details: { depositedAmountFormatted: string | null; amountOutFormatted: string | null; refundedAmountFormatted: string | null; nearTxHashes: string[]; intentHashes: string[] } };

function Badge({ status }: { status: string }) {
  const s = statusOf(status);
  return <span className={`stb ${s.tone}`} data-testid="st-badge" data-status={status}>{s.label}</span>;
}

function Row({ s }: { s: Settlement }) {
  const [st, setSt] = useState<St | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let dead = false;
    fetch(`/api/oneclick?depositAddress=${s.depositAddress}`).then((r) => r.json()).then((j) => { if (!dead) { if (j.ok) setSt(j); else setErr(true); } }).catch(() => !dead && setErr(true));
    return () => { dead = true; };
  }, [s.depositAddress]);
  const info = st ? statusOf(st.status) : null;
  return (
    <article className="card srow" data-testid="settlement">
      <div className="shead"><b>{s.label}</b>{st ? <Badge status={st.status} /> : <span className="stb wait">{err ? "status unavailable" : "…"}</span>}</div>
      {info && <p className="where"><span>Where the funds are:</span> {info.where}</p>}
      <dl className="kv">
        <dt>deposit tx</dt><dd className="mono"><a href={tx(s.depositTx)} target="_blank" rel="noreferrer">{s.depositTx.slice(0, 10)}…</a></dd>
        <dt>deposit address</dt><dd className="mono">{s.depositAddress.slice(0, 10)}…{s.depositAddress.slice(-6)}</dd>
        {st?.details.depositedAmountFormatted && <><dt>deposited</dt><dd>{st.details.depositedAmountFormatted}</dd></>}
        {st?.details.amountOutFormatted && <><dt>received</dt><dd>{st.details.amountOutFormatted}</dd></>}
        {st?.details.refundedAmountFormatted && st.details.refundedAmountFormatted !== "0" && <><dt>refunded</dt><dd>{st.details.refundedAmountFormatted}</dd></>}
        {st?.details.intentHashes?.map((h) => <Fragment key={h}><dt>intent</dt><dd className="mono"><a href={intentTx(h)} target="_blank" rel="noreferrer">{h.slice(0, 10)}…</a></dd></Fragment>)}
        {st?.details.nearTxHashes?.slice(-1).map((h) => <Fragment key={h}><dt>settlement tx</dt><dd className="mono"><a href={tx(h)} target="_blank" rel="noreferrer">{h.slice(0, 10)}…</a></dd></Fragment>)}
        <dt>quote</dt><dd>{s.quote}</dd>
      </dl>
    </article>
  );
}

export function SettleView() {
  const [origin, setOrigin] = useState<string>(OC_ASSETS[2].id);
  const [dest, setDest] = useState<string>(OC_ASSETS[0].id);
  const [amount, setAmount] = useState("0.05");
  const [dry, setDry] = useState<Dry | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setDry(null); setMsg(null);
    const o = assetById(origin); const units = o ? toUnits(amount, o.decimals) : null;
    if (!units || origin === dest) { setMsg("Pick two different assets and a positive amount."); return; }
    setBusy(true);
    try {
      const j = await (await fetch("/api/oneclick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ origin, dest, amount: units }) })).json();
      if (j.ok) setDry(j.quote); else setMsg(j.error?.message || j.error?.code || "No quote.");
    } catch { setMsg("Could not reach 1Click."); } finally { setBusy(false); }
  }
  return (
    <div className="page settle">
      <p className="eb">NEAR Intents · 1Click</p>
      <h1>Real quotes. <em>Real settlements.</em></h1>
      <p className="lead">Try a dry-run quote with no wallet and no funds, then see the orders KEYHOLE actually settled on mainnet, with their live 1Click status, where the funds sit, and explorer links. Refunded and failed orders are shown, not hidden.</p>
      <section className="card dry" data-testid="dry">
        <h2>Dry-run quote</h2>
        <p className="note">Uses <span className="mono">dry: true</span>: a real price from 1Click solvers, nothing to sign, nothing executes.</p>
        <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="dform">
          <label>From<select value={origin} onChange={(e) => setOrigin(e.target.value)}>{OC_ASSETS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
          <label>Amount<input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label>
          <label>To<select value={dest} onChange={(e) => setDest(e.target.value)}>{OC_ASSETS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
          <button className="btn b1" type="submit" disabled={busy} data-testid="dry-btn">{busy ? "…" : "Get quote"}</button>
        </form>
        {msg && <p className="note" role="alert" data-testid="dry-msg">{msg}</p>}
        {dry && <p className="dout" data-testid="dry-out"><b>{dry.amountInFormatted}</b> (${Number(dry.amountInUsd).toFixed(4)}) → <b>{dry.amountOutFormatted}</b> (${Number(dry.amountOutUsd).toFixed(4)}) · about {dry.timeEstimate}s · dry run</p>}
      </section>
      <h2 className="sh">Executed on mainnet</h2>
      <div className="sgrid">{SETTLEMENTS.map((s) => <Row key={s.depositAddress} s={s} />)}</div>
      <article className="card srow rec" data-testid="recorded-failed">
        <div className="shead"><b>{RECORDED_FAILED.label}</b><Badge status={RECORDED_FAILED.status} /></div>
        <p className="where"><span>Where the funds are:</span> {statusOf("FAILED").where}</p>
        <p className="note">{RECORDED_FAILED.note}</p>
      </article>
      <section className="card legend">
        <h2>Every status</h2>
        <ul>{(["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"] as const).map((k) => <li key={k}><Badge status={k} /><span>{statusOf(k).where}</span></li>)}</ul>
      </section>
    </div>
  );
}
