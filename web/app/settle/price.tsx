"use client";
import { useRef, useState } from "react";
import { OC_ASSETS, assetById, toUnits } from "@/lib/oneclick";
import { AmountInput, Badge, Button, TokenSelect, type TokenOption } from "@/components/ui";
import { Card, CardHeader } from "@/components/v7";

type Dry = { amountInFormatted: string; amountInUsd: string; amountOutFormatted: string; amountOutUsd: string; timeEstimate: number };

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

/**
 * "Check a price": a dry 1Click quote for any pair of the listed assets. Nothing is signed and nothing moves. The quote comes
 * from /api/oneclick (POST), which only ever makes dry quotes.
 */
export function PriceCheck() {
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

  // A result or an error belongs to the inputs it was asked for: any change to them clears it, so a cleared field shows only its own hint.
  const seq = useRef(0);
  const clearOut = () => { seq.current += 1; setDry(null); setMsg(null); };
  const amountHint = amount.trim() !== "" && !units ? "Enter an amount above zero." : amount.trim() === "" ? "Enter an amount above zero." : null;

  async function run() {
    setDry(null); setMsg(null);
    if (!units || origin === dest) { setMsg(!units ? "Enter an amount above zero." : "Pick two different assets."); return; }
    const mine = ++seq.current;
    setBusy(true);
    try {
      const j = await (await fetch("/api/oneclick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ origin, dest, amount: units }) })).json();
      if (mine !== seq.current) return; // the inputs changed while this price was on its way: it is not for what is on screen
      if (j.ok) setDry(j.quote); else setMsg(human(j.error?.code, j.error?.message));
    } catch { if (mine === seq.current) setMsg("Could not reach 1Click. Check your connection and try again."); } finally {
      setBusy(false);
      requestAnimationFrame(() => outRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    }
  }

  const sym = (x: typeof o) => x?.label.split(" · ")[0] ?? "";
  return (
    <Card as="section" testid="dry" labelledBy="act-dry-h" className="act-dry">
      <CardHeader title="Check a price" id="act-dry-h" action={<Badge tone="info" testid="dry-badge">Price only · nothing moves</Badge>} />
      <p className="act-note">A live price from 1Click solvers. Nothing is signed and nothing executes.</p>
      <form className="act-dry-form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <TokenSelect label="From" options={OPTIONS} value={origin} onChange={(v) => { setOrigin(v); clearOut(); }} testid="oc-from" />
        <AmountInput label="Amount" value={amount} onChange={(v) => { setAmount(v); clearOut(); }} symbol={sym(o)} error={units ? null : amountHint} testid="oc-amount" />
        <TokenSelect label="To" options={OPTIONS} value={dest} onChange={(v) => { setDest(v); clearOut(); }} testid="oc-to" />
        <Button type="submit" loading={busy} loadingLabel="Asking solvers" testid="dry-btn">Get price</Button>
      </form>
      <div ref={outRef} aria-live="polite" className="act-out">
        {msg && units && <p className="act-note act-alert" role="alert" data-testid="dry-msg">{msg}</p>}
        {dry && (
          <article className="act-quote" data-testid="dry-out" aria-label="Price quote">
            <Badge tone="info" testid="dry-tag">Price quote · dry run · nothing moves</Badge>
            <p className="act-route">{o?.label} <span aria-hidden="true">→</span> {d?.label}</p>
            <dl className="act-quote-grid">
              <div><dt>You send</dt><dd>{dry.amountInFormatted} <small>${Number(dry.amountInUsd).toFixed(4)}</small></dd></div>
              <div><dt>You receive</dt><dd>{dry.amountOutFormatted} <small>${Number(dry.amountOutUsd).toFixed(4)}</small></dd></div>
              <div><dt>Fee and spread</dt><dd>${(Number(dry.amountInUsd) - Number(dry.amountOutUsd)).toFixed(4)} <small>USD in minus USD out</small></dd></div>
              <div><dt>Estimated time</dt><dd>about {dry.timeEstimate}s</dd></div>
            </dl>
            <p className="act-note">Quoted by 1Click solvers. Nothing was signed and no funds moved.</p>
          </article>
        )}
      </div>
    </Card>
  );
}
