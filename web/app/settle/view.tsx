"use client";
import { useEffect, useRef, useState } from "react";
import { OC_ASSETS, statusOf, toUnits, assetById, fundsStep } from "@/lib/oneclick";
import { SETTLEMENTS, RECORDED_FAILED, VAULT_TRADE, type Settlement } from "@/lib/settlements";
import { tx, txAlt, intentTx } from "@/lib/config";
import { AgentPanel } from "./agent";
import { Badge as UBadge, Button, Proof, Purpose, Skeleton, Spinner, type ProofRow, type Tone } from "@/components/ui";
import { TokenIcon } from "@/components/TokenIcon";

type Dry = { amountInFormatted: string; amountInUsd: string; amountOutFormatted: string; amountOutUsd: string; timeEstimate: number };
type St = { status: string; updatedAt?: string; details: { depositedAmountFormatted: string | null; amountOutFormatted: string | null; refundedAmountFormatted: string | null; nearTxHashes: string[]; intentHashes: string[] } };

const TONE: Record<string, Tone> = { ok: "ok", bad: "bad", wait: "wait", info: "info", warn: "warn" };
function Badge({ status }: { status: string }) {
  const s = statusOf(status);
  return <UBadge tone={TONE[s.tone] ?? "info"} testid="st-badge" status={status}>{s.label}</UBadge>;
}

const PROG = ["Deposit sent", "Intent matched", "Settled", "Funds here"] as const;
/** Four plain steps across the card; the last one says "Refunded" when the funds went back. */
function Progress({ status }: { status: string }) {
  const f = fundsStep(status);
  if (!f) return null;
  return (
    <ol className="oprog" data-testid="funds-path" data-step={f.step} data-refund={f.refund ? "1" : "0"} aria-label="Order progress">
      {PROG.map((label, i) => {
        const cls = i < f.step ? "done" : i === f.step ? (f.refund ? "here refund" : f.step === 3 ? "done" : "here") : "";
        return <li key={label} className={cls}>{i === 3 && f.refund ? "Refunded to sender" : label}</li>;
      })}
    </ol>
  );
}
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" }) + " (UTC+2)";

function Row({ s }: { s: Settlement }) {
  const [st, setSt] = useState<St | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let dead = false;
    fetch(`/api/oneclick?depositAddress=${s.depositAddress}`).then((r) => r.json()).then((j) => { if (!dead) { if (j.ok) setSt(j); else setErr(true); } }).catch(() => !dead && setErr(true));
    return () => { dead = true; };
  }, [s.depositAddress]);
  const info = st ? statusOf(st.status) : null;
  const rows: ProofRow[] = [
    { label: "deposit tx", value: s.depositTx, href: s.depositTxUrl ?? tx(s.depositTx), alt: s.depositTxUrl ? undefined : txAlt(s.depositTx) },
    { label: "deposit address", value: s.depositAddress },
    ...(st?.details.intentHashes ?? []).map((h) => ({ label: "intent", value: h, href: intentTx(h) })),
    ...(st?.details.nearTxHashes ?? []).slice(-1).map((h) => ({ label: "settlement tx", value: h, href: tx(h), alt: txAlt(h) })),
    ...(s.destTx ? [{ label: "destination tx", value: s.destTx.hash, href: s.destTx.url }] : []),
  ];
  return (
    <article className="ocard" data-testid="settlement" data-deposit={s.depositAddress}>
      <div className="ohead">
        <h3 className="oroute">{s.label}</h3>
        {st ? <Badge status={st.status} /> : err ? <UBadge tone="warn">Status unavailable</UBadge> : <span data-testid="st-loading"><Spinner label="Reading live status" /></span>}
      </div>
      <p className="oamt">{s.quote}{st?.details.amountOutFormatted ? <> · <b>received {st.details.amountOutFormatted}</b></> : null}{st?.details.refundedAmountFormatted && st.details.refundedAmountFormatted !== "0" ? <> · <b>refunded {st.details.refundedAmountFormatted}</b></> : null}</p>
      {st ? <Progress status={st.status} /> : !err && <Skeleton lines={1} />}
      {info && <p className="owhere"><b>Where the funds are:</b> {info.where}</p>}
      {s.note && <p className="note" style={{ margin: 0 }}>{s.note}</p>}
      {st?.updatedAt && <p className="note" style={{ margin: 0 }}>Live from 1Click, updated <span data-testid="st-updated">{when(st.updatedAt)}</span></p>}
      <Proof rows={rows} />
    </article>
  );
}

const human = (code?: string, message?: string) => {
  const M: Record<string, string> = {
    policy_transaction_limit_exceeded: "That amount is above this key's per-trade limit, so the policy refused it. Try a smaller amount.",
    rate_limited: "Too many quotes in a minute. Wait a few seconds and try again.",
    no_quote: "No solver offered a price for this pair and amount right now. Try a different amount or pair.",
  };
  return (code && M[code]) || message || "No quote came back. Try again in a moment.";
};

/** A token picker: the real token mark (or monogram) beside a native select, so the choice is readable and keyboard-operable. */
function AssetSelect({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const a = assetById(value);
  return (
    <label className="pick" htmlFor={id}>
      <span className="pick-l">{label}</span>
      <span className="pick-row">
        <TokenIcon assetId={a?.id} symbol={a?.label.split(" · ")[0]} chain={a?.chain} size="sm" />
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {OC_ASSETS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </span>
    </label>
  );
}

export function SettleView() {
  const [origin, setOrigin] = useState<string>(OC_ASSETS[2].id);
  const [dest, setDest] = useState<string>(OC_ASSETS[0].id);
  const [amount, setAmount] = useState("0.05");
  const [dry, setDry] = useState<Dry | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const outRef = useRef<HTMLDivElement>(null);
  async function run() {
    setDry(null); setMsg(null);
    const o = assetById(origin); const units = o ? toUnits(amount, o.decimals) : null;
    if (!units || origin === dest) { setMsg("Pick two different assets and a positive amount."); return; }
    setBusy(true);
    try {
      const j = await (await fetch("/api/oneclick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ origin, dest, amount: units }) })).json();
      if (j.ok) setDry(j.quote); else setMsg(human(j.error?.code, j.error?.message));
    } catch { setMsg("Could not reach 1Click. Check your connection and try again."); } finally { setBusy(false); requestAnimationFrame(() => outRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })); }
  }
  return (
    <div className="page settle">
      <Purpose eyebrow="NEAR Intents · 1Click · mainnet" title={<>Real quotes. <em>Real settlements.</em></>}
        line={<>Get a live cross-chain price with no wallet, then see every order KEYHOLE really settled: where the money is now, step by step, with proof one click away.</>} />
      <section className="card dry" data-testid="dry">
        <h2>1 · Get a live price (no wallet, nothing moves)</h2>
        <p className="note">This asks 1Click solvers for a real price with <span className="mono">dry: true</span>. Nothing is signed and nothing executes.</p>
        <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="dform">
          <AssetSelect id="oc-from" label="From" value={origin} onChange={setOrigin} />
          <label className="pick-amt"><span className="pick-l">Amount</span><input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label>
          <AssetSelect id="oc-to" label="To" value={dest} onChange={setDest} />
          <Button type="submit" loading={busy} loadingLabel="Asking solvers" testid="dry-btn">Get quote</Button>
        </form>
        <div ref={outRef} aria-live="polite">
          {msg && <p className="note" role="alert" data-testid="dry-msg">{msg}</p>}
          {dry && (
            <article className="bestq" data-testid="dry-out" aria-label="Best quote">
              <p className="bestq-tag">Best quote · dry run · nothing moves</p>
              <p className="bestq-route">{assetById(origin)?.label} <span aria-hidden="true">→</span> {assetById(dest)?.label}</p>
              <dl className="bestq-grid">
                <div><dt>You send</dt><dd>{dry.amountInFormatted} <small>${Number(dry.amountInUsd).toFixed(4)}</small></dd></div>
                <div><dt>You receive</dt><dd>{dry.amountOutFormatted} <small>${Number(dry.amountOutUsd).toFixed(4)}</small></dd></div>
                <div><dt>Fee and spread</dt><dd>${(Number(dry.amountInUsd) - Number(dry.amountOutUsd)).toFixed(4)} <small>USD in minus USD out</small></dd></div>
                <div><dt>Estimated time</dt><dd>about {dry.timeEstimate}s</dd></div>
              </dl>
              <p className="note">The quote came from 1Click solvers. Nothing was signed and no funds moved.</p>
            </article>
          )}
        </div>
      </section>
      <AgentPanel />
      <h2 className="ush">2 · A private vault trade, end to end</h2>
      <p className="usub">The holder signed one swap. The enclave checked the signature, the holder and the Bronze caps, then the key&apos;s sealed account swapped through NEAR Intents. Intel TDX attested the answer.</p>
      <article className="ocard" data-testid="vault-trade">
        <div className="ohead"><h3 className="oroute">{VAULT_TRADE.amountIn}<span className="arr">→</span>{VAULT_TRADE.amountOut}</h3><UBadge tone="ok">Settled</UBadge></div>
        <p className="oamt">Inside the vault of key {VAULT_TRADE.token} · build {VAULT_TRADE.build}</p>
        <div className="uact"><Button variant="secondary" href={`/verify?call=${VAULT_TRADE.callId}`} testid="vault-trade-verify">Verify the enclave call</Button></div>
        <Proof rows={[
          { label: "enclave call", value: VAULT_TRADE.callId, href: `/verify?call=${VAULT_TRADE.callId}`, internal: true },
          { label: "intent hash", value: VAULT_TRADE.intentHash, href: intentTx(VAULT_TRADE.intentHash) },
          { label: "account", value: VAULT_TRADE.account },
          { label: "evidence file", value: VAULT_TRADE.file },
        ]} />
      </article>
      <h2 className="ush">3 · 1Click orders executed on mainnet</h2>
      <p className="usub">Each card reads its status live from 1Click. Refunded orders are shown, not hidden.</p>
      <div className="ogrid">{SETTLEMENTS.map((s) => <Row key={s.depositAddress} s={s} />)}</div>
      <h2 className="ush">Example only: the shape of a failed order</h2>
      <article className="ocard rec" data-testid="recorded-failed">
        <div className="ohead"><h3 className="oroute">{RECORDED_FAILED.label}</h3><Badge status={RECORDED_FAILED.status} /></div>
        <p className="owhere"><b>Where the funds are:</b> {statusOf("FAILED").where}</p>
        <p className="note">{RECORDED_FAILED.note}</p>
      </article>
      <details className="card legend">
        <summary><h2 style={{ display: "inline" }}>What each status means</h2></summary>
        <ul>{(["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"] as const).map((k) => <li key={k}><Badge status={k} /><span>{statusOf(k).where}</span></li>)}</ul>
      </details>
    </div>
  );
}
