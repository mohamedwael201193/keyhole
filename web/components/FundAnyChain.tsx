"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { FUND_ORIGINS, FUND_MAX, FUND_STEPS, fundsStep, isTerminalStatus, statusOf, toUnits, refundOk } from "@/lib/oneclick";
import { Spinner } from "./ui";
import { TokenMark } from "./TokenMark";
import { CopyButton, QRFrame } from "./motion";

type Q = { depositAddress: string; amountInFormatted: string | null; amountOutFormatted: string | null; timeEstimate: number | null; deadline: string | null };

/** Fund from another chain with a documented 1Click quote whose recipient is the vault deposit address. */
export function FundAnyChain({ recipient, evm }: { recipient: string; evm?: string | null }) {
  const [origin, setOrigin] = useState<string>(FUND_ORIGINS.find((a) => a.chain === "base")?.id ?? FUND_ORIGINS[0].id);
  const o = FUND_ORIGINS.find((a) => a.id === origin)!;
  const [amt, setAmt] = useState("1");
  const [refund, setRefund] = useState(evm ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState<Q | null>(null);
  const [svg, setSvg] = useState("");
  const [st, setSt] = useState<{ status?: string; details?: { originChainTxHashes?: { hash: string }[]; nearTxHashes?: string[] } } | null>(null);
  const units = toUnits(amt, o.decimals);
  const tooBig = !!units && BigInt(units) > FUND_MAX[o.id];
  const refundValid = refundOk(o.chain, refund.trim());
  useEffect(() => { if (evm && o.chain !== "sol" && !refund) setRefund(evm); }, [evm, o.chain, refund]);
  useEffect(() => { if (q) QRCode.toString(q.depositAddress, { type: "svg", margin: 1, width: 168 }).then(setSvg).catch(() => setSvg("")); }, [q]);
  useEffect(() => {
    if (!q) return;
    let stop = false;
    let id: ReturnType<typeof setInterval> | undefined;
    const halt = () => { if (id !== undefined) { clearInterval(id); id = undefined; } };
    const tick = async () => {
      const r = await fetch(`/api/oneclick?depositAddress=${encodeURIComponent(q.depositAddress)}`).then((x) => x.json()).catch(() => null);
      if (stop) return;
      if (r?.ok) { setSt(r); if (isTerminalStatus(r.status)) halt(); }
    };
    void tick();
    id = setInterval(() => void tick(), 10_000);
    return () => { stop = true; halt(); };
  }, [q]);
  const get = async () => {
    if (!units || tooBig || !refundValid) return;
    setBusy(true); setErr(null); setQ(null); setSt(null);
    const r = await fetch("/api/oneclick/fund", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ origin, dest: "usdc", amount: units, recipient, refundTo: refund.trim() }) }).then((x) => x.json()).catch(() => null);
    setBusy(false);
    if (r?.ok) setQ(r.quote); else setErr(r?.error?.code === "rate_limited" ? "Too many quotes in a minute. Wait a moment and try again." : "No solver quoted this route right now. Try another chain or amount.");
  };
  const fs = fundsStep(st?.status);
  const sym = o.label.split(" · ")[0], chain = o.label.split(" · ")[1];
  return (
    <div className="fanyc" data-testid="fund-any-chain">
      <p className="vhelp">Send from {chain} instead: 1Click (NEAR Intents) swaps it to USDC and delivers to your vault deposit address. Up to about $5.</p>
      <div className="fanyc-row">
        <label>From <TokenMark symbol={sym} chain={o.chain} assetId={o.id} size={24} /> <select value={origin} onChange={(e) => { setOrigin(e.target.value); setQ(null); }} data-testid="fac-origin">{FUND_ORIGINS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
        <label>Amount <input inputMode="decimal" value={amt} onChange={(e) => { setAmt(e.target.value); setQ(null); }} data-testid="fac-amount" /> {sym}</label>
      </div>
      <label className="fanyc-ref">Refund address on {chain} (if the swap can&apos;t fill) <input value={refund} onChange={(e) => setRefund(e.target.value)} placeholder={o.chain === "sol" ? "Solana address" : "0x…"} data-testid="fac-refund" /></label>
      {tooBig && <p className="vhelp err">Keep it small: at most {o.id === "nep141:sol.omft.near" ? "0.03 SOL" : `5 ${sym}`}.</p>}
      {refund && !refundValid && <p className="vhelp err">That is not a {chain} address.</p>}
      <button className="btn b1" type="button" disabled={!units || tooBig || !refundValid || busy} onClick={() => void get()} data-testid="fac-quote">{busy ? <><Spinner label="Asking solvers" /> Asking solvers…</> : "Get a deposit address"}</button>
      {err && <p className="vhelp err" role="alert">{err}</p>}
      {q && (
        <div className="depqr" data-testid="fac-deposit">
          {svg && <QRFrame caption="Scan to copy the address"><div className="qr" role="img" aria-label={`QR code of the ${chain} deposit address`} dangerouslySetInnerHTML={{ __html: svg }} /></QRFrame>}
          <div>
            <p>Send exactly <b data-testid="fac-send">{q.amountInFormatted ?? amt} {sym}</b> on <b>{chain}</b> to:</p>
            <div className="vbox ro"><span className="v addr">{q.depositAddress}</span><CopyButton value={q.depositAddress} /></div>
            <p className="vhelp">You receive about {q.amountOutFormatted ?? "—"} USDC in your vault{q.timeEstimate ? `, usually within ${q.timeEstimate}s` : ""}. Quote valid until {q.deadline ? new Date(q.deadline).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}.</p>
            <ol className="fanyc-steps" data-testid="fac-progress">{FUND_STEPS.map((s, i) => <li key={s} data-state={fs && i < fs.step ? "done" : fs && i === fs.step ? "now" : "next"}>{i === 3 && fs?.refund ? "Refunded to you" : i === 3 ? "Your vault" : s}</li>)}</ol>
            <p className="note" data-testid="fac-status">{st ? `${statusOf(st.status).label}. ${statusOf(st.status).where}` : "Checking status…"} <a href={`https://explorer.near-intents.org/transactions/${q.depositAddress}`} target="_blank" rel="noreferrer">Intents explorer ↗</a></p>
          </div>
        </div>
      )}
    </div>
  );
}
