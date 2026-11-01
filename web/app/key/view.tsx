"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { checkLog, holders, short, type ChainCheck, type KeyLogBody } from "@/lib/keylog";
import { TEE_MINTER, acct } from "@/lib/config";

const ID = /^k[a-z0-9]{4,39}$/i;
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function KeyHistoryView() {
  const [id, setId] = useState("");
  const [body, setBody] = useState<KeyLogBody | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [ck, setCk] = useState<ChainCheck | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(tid: string) {
    setErr(null); setBody(null); setCk(null); setCallId(null);
    if (!ID.test(tid)) { setErr("Enter a key id like k5f4750858f328940."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/worker", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "provenance", token_id: tid }) });
      const j = await r.json();
      const out = j?.output?.ok ? j.output : null;
      if (!out) { setErr(j?.output?.error?.message || j?.error?.message || "The enclave did not return a log for this key."); return; }
      const b = out as KeyLogBody; setBody(b); setCallId(j.call_id ?? null); setCk(checkLog(b, TEE_MINTER));
    } catch { setErr("Could not reach the enclave. Try again in a moment."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const q = new URLSearchParams(location.search).get("id") ?? "";
    setId(q); if (q) void load(q);
  }, []);

  const hs = body ? holders(body.events) : [];
  const ok = !!ck && ck.chain && ck.head && ck.sig && ck.minter;
  const pill = (pass: boolean, label: string, tid: string) => <span className={`kpill ${pass ? "" : "bad"}`} data-testid={tid} data-pass={String(pass)}>{pass ? "✓" : "✕"} {label}</span>;
  return (
    <div className="page khist">
      <p className="eb">Key history · public</p>
      <h1>Every key has a <em>book.</em></h1>
      <p className="lead">Who held this key, and when it deposited, paid out and traded. The enclave keeps a hash-chained log and signs its head; this page re-checks every link in your browser. Amounts stay sealed: only the holder who wrote a row can read its detail.</p>
      <form className="field" onSubmit={(e) => { e.preventDefault(); history.replaceState(null, "", `/key?id=${id.trim()}`); void load(id.trim()); }}>
        <label htmlFor="kid" className="sr-only">key id</label>
        <input id="kid" className="input" value={id} onChange={(e) => setId(e.target.value)} placeholder="k5f4750858f328940" spellCheck={false} />
        <button className="btn b1" type="submit" disabled={busy} data-testid="key-load">{busy ? "…" : "Open"}</button>
      </form>
      {err && <p className="note" role="alert" style={{ color: "var(--coral)" }}>{err}</p>}
      {body && ck && (
        <>
          <div className="kpills" data-testid="key-verdict" data-ok={String(ok)}>
            {pill(ck.chain, `${body.events.length} events chain`, "k-chain")}
            {pill(ck.head, "head matches", "k-head")}
            {pill(ck.sig, "head signed", "k-sig")}
            {pill(ck.minter, "signer is the TEE minter", "k-minter")}
            {callId && <Link className="kpill link" href={`/verify?call=${callId}`}>attested call {callId.slice(0, 8)} ↗</Link>}
          </div>
          <section className="card khold">
            <h2>Holders</h2>
            <div className="ktable" data-testid="holders">
              <div className="kr kh"><span>Holder</span><span>From</span><span>To</span><span>Deposits</span><span>Paid out</span><span>Trades</span></div>
              {hs.map((h, i) => (
                <div className="kr" key={`${h.owner}-${i}`} data-testid="holder-row">
                  <span className="mono"><a href={acct(h.owner)} target="_blank" rel="noreferrer">{short(h.owner)}</a></span>
                  <span data-l="From">{when(h.from_ms)}</span><span data-l="To">{h.to_ms ? when(h.to_ms) : "now"}</span>
                  <span data-l="Deposits">{h.deposits}</span><span data-l="Paid out" data-testid="paid-out">{h.withdraws}</span><span data-l="Trades">{h.trades}</span>
                </div>
              ))}
            </div>
            <p className="note">Paid out counts withdraw events. USD totals are private to each holder; a holder can publish a signed total from the vault (<Link href="/pnl">signed PnL</Link>).</p>
          </section>
          <section className="card klog">
            <h2>Event log</h2>
            <ol>
              {body.events.map((e) => (
                <li key={e.i}><b>{e.kind}</b><span className="mono">{short(e.owner)}</span><span>{when(e.ts_ms)}</span><span className="mono h">{e.hash.slice(0, 12)}</span></li>
              ))}
            </ol>
            <p className="mono khead">head {body.head}</p>
          </section>
        </>
      )}
    </div>
  );
}
