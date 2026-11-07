"use client";
import { useEffect, useRef, useState } from "react";
import { OC_ASSETS, statusOf, toUnits, assetById, fundsStep } from "@/lib/oneclick";
import { SETTLEMENTS, RECORDED_FAILED, VAULT_TRADE, type Settlement } from "@/lib/settlements";
import { tx, txAlt, intentTx } from "@/lib/config";
import { AgentPanel } from "./agent";
import { AmountInput, Badge, Button, Card, Proof, Purpose, Skeleton, Spinner, Stepper, TokenSelect, type ProofRow, type StepItem, type TokenOption, type Tone } from "@/components/ui";
import "./settle.css";

type Dry = { amountInFormatted: string; amountInUsd: string; amountOutFormatted: string; amountOutUsd: string; timeEstimate: number };
type St = { status: string; updatedAt?: string; details: { depositedAmountFormatted: string | null; amountOutFormatted: string | null; refundedAmountFormatted: string | null; nearTxHashes: string[]; intentHashes: string[] } };

const TONE: Record<string, Tone> = { ok: "ok", bad: "bad", wait: "wait", info: "info", warn: "warn" };
function StatusBadge({ status }: { status: string }) {
  const s = statusOf(status);
  return <Badge tone={TONE[s.tone] ?? "info"} testid="st-badge" status={status}>{s.label}</Badge>;
}

const PROG = ["Deposit sent", "Intent matched", "Settled", "Funds here"] as const;
/** Four plain steps. The last one says "Refunded to sender" when the funds went back. */
function Progress({ status }: { status: string }) {
  const f = fundsStep(status);
  if (!f) return null;
  const steps: StepItem[] = PROG.map((label, i) => ({
    label: i === 3 && f.refund ? "Refunded to sender" : label,
    state: i < f.step ? "done" : i === f.step ? (f.step === 3 && !f.refund ? "done" : "current") : "todo",
  }));
  return (
    <div data-testid="funds-path" data-step={f.step} data-refund={f.refund ? "1" : "0"} className="st-path">
      <Stepper label="Order progress" steps={steps} />
    </div>
  );
}
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" }) + " (UTC+2)";

/** One real order. Its status is read live from 1Click; a status that cannot be read says so. */
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
    <Card as="article" className="st-order" testid="settlement" data-deposit={s.depositAddress}>
      <div className="st-orderhead">
        <h3>{s.label}</h3>
        {st ? <StatusBadge status={st.status} /> : err ? <Badge tone="warn">Status unavailable</Badge> : <span data-testid="st-loading"><Spinner label="Reading live status" /></span>}
      </div>
      <p className="st-amt">{s.quote}{st?.details.amountOutFormatted ? <> · <b>received {st.details.amountOutFormatted}</b></> : null}{st?.details.refundedAmountFormatted && st.details.refundedAmountFormatted !== "0" ? <> · <b>refunded {st.details.refundedAmountFormatted}</b></> : null}</p>
      {st ? <Progress status={st.status} /> : !err && <Skeleton lines={1} />}
      {info && <p className="st-where"><b>Where the funds are:</b> {info.where}</p>}
      {s.note && <p className="st-note">{s.note}</p>}
      {st?.updatedAt && <p className="st-note">Live from 1Click, updated <span data-testid="st-updated">{when(st.updatedAt)}</span></p>}
      <Proof rows={rows} />
    </Card>
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

/** The 1Click assets, as token options. The label is "SYMBOL · chain". */
const OPTIONS: TokenOption[] = OC_ASSETS.map((a) => {
  const [symbol, chain] = a.label.split(" · ");
  return { id: a.id, symbol, name: chain, assetId: a.id, chain: a.chain };
});

export function SettleView() {
  const [origin, setOrigin] = useState<string>(OC_ASSETS[2].id);
  const [dest, setDest] = useState<string>(OC_ASSETS[0].id);
  const [amount, setAmount] = useState("0.05");
  const [dry, setDry] = useState<Dry | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const outRef = useRef<HTMLDivElement>(null);
  const o = assetById(origin);
  const d = assetById(dest);
  const units = o ? toUnits(amount, o.decimals) : null;
  async function run() {
    setDry(null); setMsg(null);
    if (!units || origin === dest) { setMsg("Pick two different assets and a positive amount."); return; }
    setBusy(true);
    try {
      const j = await (await fetch("/api/oneclick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ origin, dest, amount: units }) })).json();
      if (j.ok) setDry(j.quote); else setMsg(human(j.error?.code, j.error?.message));
    } catch { setMsg("Could not reach 1Click. Check your connection and try again."); } finally { setBusy(false); requestAnimationFrame(() => outRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })); }
  }
  const sym = (x: typeof o) => x?.label.split(" · ")[0] ?? "";
  return (
    <div className="page settle">
      <Purpose eyebrow="NEAR Intents · 1Click · mainnet" title={<>Real quotes. <em>Real settlements.</em></>}
        line="Check a live cross-chain price with no wallet, then see every order KEYHOLE really settled: where its money is now, step by step, with proof one click away." />

      <Card as="section" className="st-card st-dry" testid="dry" aria-labelledby="st-dry-h">
        <div className="st-cardhead">
          <h2 id="st-dry-h">Check a price</h2>
          <Badge tone="info" testid="dry-badge">Price only · nothing moves</Badge>
        </div>
        <p className="st-note">A live price from 1Click solvers. Nothing is signed and nothing executes.</p>
        <form className="st-form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <TokenSelect label="From" options={OPTIONS} value={origin} onChange={setOrigin} testid="oc-from" />
          <AmountInput label="Amount" value={amount} onChange={setAmount} symbol={sym(o)} error={units ? null : "Enter an amount above zero."} testid="oc-amount" />
          <TokenSelect label="To" options={OPTIONS} value={dest} onChange={setDest} testid="oc-to" />
          <Button type="submit" loading={busy} loadingLabel="Asking solvers" testid="dry-btn">Get price</Button>
        </form>
        <div ref={outRef} aria-live="polite" className="st-out">
          {msg && <p className="st-note st-alert" role="alert" data-testid="dry-msg">{msg}</p>}
          {dry && (
            <article className="st-quote" data-testid="dry-out" aria-label="Price quote">
              <p className="st-route">{o?.label} <span aria-hidden="true">→</span> {d?.label}</p>
              <dl className="st-grid">
                <div><dt>You send</dt><dd>{dry.amountInFormatted} <small>${Number(dry.amountInUsd).toFixed(4)}</small></dd></div>
                <div><dt>You receive</dt><dd>{dry.amountOutFormatted} <small>${Number(dry.amountOutUsd).toFixed(4)}</small></dd></div>
                <div><dt>Fee and spread</dt><dd>${(Number(dry.amountInUsd) - Number(dry.amountOutUsd)).toFixed(4)} <small>USD in minus USD out</small></dd></div>
                <div><dt>Estimated time</dt><dd>about {dry.timeEstimate}s</dd></div>
              </dl>
              <p className="st-note">Quoted by 1Click solvers. Nothing was signed and no funds moved.</p>
            </article>
          )}
        </div>
      </Card>

      <AgentPanel />

      <h2 className="st-section">A private vault trade, end to end</h2>
      <p className="st-sub">The holder signed one swap. The enclave checked the signature, the holder and the Bronze caps, then the key&apos;s sealed account swapped through NEAR Intents. Intel TDX attested the answer.</p>
      <Card as="article" className="st-order" testid="vault-trade">
        <div className="st-orderhead">
          <h3>{VAULT_TRADE.amountIn} <span aria-hidden="true">→</span> {VAULT_TRADE.amountOut}</h3>
          <Badge tone="ok">Settled</Badge>
        </div>
        <p className="st-note">Inside the vault of key {VAULT_TRADE.token} · build {VAULT_TRADE.build}</p>
        <div className="st-actions"><Button variant="secondary" href={`/verify?call=${VAULT_TRADE.callId}`} testid="vault-trade-verify">Verify the enclave call</Button></div>
        <Proof rows={[
          { label: "enclave call", value: VAULT_TRADE.callId, href: `/verify?call=${VAULT_TRADE.callId}`, internal: true },
          { label: "intent hash", value: VAULT_TRADE.intentHash, href: intentTx(VAULT_TRADE.intentHash) },
          { label: "account", value: VAULT_TRADE.account },
          { label: "evidence file", value: VAULT_TRADE.file },
        ]} />
      </Card>

      <h2 className="st-section">1Click orders executed on mainnet</h2>
      <p className="st-sub">Each card reads its status live from 1Click. Refunded orders are shown, not hidden.</p>
      <div className="st-orders">{SETTLEMENTS.map((s) => <Row key={s.depositAddress} s={s} />)}</div>

      <h2 className="st-section">Example only: the shape of a failed order</h2>
      <Card as="article" className="st-order st-recorded" testid="recorded-failed">
        <div className="st-orderhead"><h3>{RECORDED_FAILED.label}</h3><StatusBadge status={RECORDED_FAILED.status} /></div>
        <p className="st-where"><b>Where the funds are:</b> {statusOf("FAILED").where}</p>
        <p className="st-note">{RECORDED_FAILED.note}</p>
      </Card>

      <details className="st-card st-legend">
        <summary>What each status means</summary>
        <ul>{(["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"] as const).map((k) => <li key={k}><StatusBadge status={k} /><span>{statusOf(k).where}</span></li>)}</ul>
      </details>
    </div>
  );
}
