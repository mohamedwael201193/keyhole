"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DEMO_META, DEMO_STEPS, type DemoProof } from "@/lib/demo";
import { intentTx, tx } from "@/lib/config";
import { Button } from "@/components/ui/button";
import "../public-pages.css";

function Proof({ p }: { p: DemoProof }) {
  if (p.kind === "call") return <Link className="dproof" href={`/verify?call=${p.ref}`}>verify call {p.ref.slice(0, 8)} →</Link>;
  if (p.kind === "intent") return <a className="dproof" href={intentTx(p.ref)} target="_blank" rel="noreferrer">intent {p.ref.slice(0, 8)}… ↗</a>;
  return <a className="dproof" href={tx(p.ref)} target="_blank" rel="noreferrer">tx {p.ref.slice(0, 8)}… ↗</a>;
}

export function DemoView() {
  const [at, setAt] = useState(0);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto || at >= DEMO_STEPS.length - 1) return;
    const id = window.setTimeout(() => setAt((x) => x + 1), 2600);
    return () => window.clearTimeout(id);
  }, [at, auto]);
  const go = (i: number) => { setAuto(false); setAt(i); };
  return (
    <div className="page demo pp pp-demo" data-testid="demo-page">
      <div className="pp-demo-banner" role="note" data-testid="demo-banner">
        <span className="pp-demo-tag">DEMO · read-only</span>
        <p>This is a replay of a real mainnet session ({DEMO_META.account}, {DEMO_META.date}, previous build {DEMO_META.build}). Nothing is signed or moved.</p>
      </div>
      <h1>The whole flow, <em>no wallet needed.</em></h1>
      <ol className="dsteps" aria-label="Demo steps">
        {DEMO_STEPS.map((s, i) => (
          <li key={s.id}><button type="button" className={i === at ? "on" : i < at ? "done" : ""} onClick={() => go(i)} aria-current={i === at ? "step" : undefined}><span>{i < at ? "✓" : i + 1}</span>{s.title}</button></li>
        ))}
      </ol>
      <div className="dgrid">
        {DEMO_STEPS.map((s, i) => (
          <section key={s.id} className={`dcard${i === at ? " active" : ""}${i > at ? " later" : ""}`} data-testid={`demo-${s.id}`} onClick={() => go(i)}>
            <header><span className="dn">{i + 1}</span><h2>{s.title}</h2><span className={`dres ${s.ok ? "ok" : "ref"}`}>{s.ok ? "✓ done" : "✕ refused, as designed"}</span></header>
            <p className="ddoes">{s.does}</p>
            <p className="dout" data-testid={`demo-${s.id}-result`}>{s.result}</p>
            {s.rows && <dl>{s.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="mono">{v}</dd></div>)}</dl>}
            <p className="dproofs">{s.proofs.map((p) => <Proof key={p.ref} p={p} />)}</p>
          </section>
        ))}
      </div>
      <div className="dnext">
        <Button href="/vault" testid="demo-open-vault">Open your own vault</Button>
        <Button variant="secondary" href="/judge">Judge path</Button>
        <Button variant="ghost" onClick={() => { setAt(0); setAuto(true); }}>Replay</Button>
      </div>
    </div>
  );
}
