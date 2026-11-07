"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { checkLog, holders, short, type ChainCheck, type KeyLogBody } from "@/lib/keylog";
import { TEE_MINTER } from "@/lib/config";
import { TxLink } from "@/components/TxLink";
import { CopyBtn, Spinner } from "@/components/ui";

/** New ids are k + hex; the first keys were minted with plain numbers (0, 1, 2…). */
export const KEY_ID = /^(k[a-z0-9]{4,39}|\d{1,9})$/i;
const ID = KEY_ID;
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function KeyHistoryView() {
  const [id, setId] = useState("");
  const [body, setBody] = useState<KeyLogBody | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [ck, setCk] = useState<ChainCheck | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [legacy, setLegacy] = useState<string | null>(null);

  async function load(tid: string) {
    setErr(null); setBody(null); setCk(null); setCallId(null); setLegacy(null);
    if (!ID.test(tid)) { setErr("That is not a key id. Paste one from the gallery, like k5f4750858f328940 or 0."); return; }
    if (/^\d+$/.test(tid)) { setLegacy(tid); return; }
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
      <p className="lead">Who held this key, and when it deposited, paid out and traded. This page re-checks every link in your browser; amounts stay sealed.</p>
      <form className="field" onSubmit={(e) => { e.preventDefault(); history.replaceState(null, "", `/key?id=${id.trim()}`); void load(id.trim()); }}>
        <label htmlFor="kid" className="sr-only">key id</label>
        <input id="kid" className="input" value={id} onChange={(e) => setId(e.target.value)} placeholder="k5f4750858f328940" spellCheck={false} />
        <button className="btn b1" type="submit" disabled={busy} data-testid="key-load">{busy ? <><Spinner label="Opening" /> Opening…</> : "Open"}</button>
      </form>
      <p className="vhelp" data-testid="key-help">Paste a key id, for example <span className="mono">k5f4750858f328940</span> or <span className="mono">0</span>.</p>
      {busy && !body && <p className="note" data-testid="key-loading"><Spinner label="Loading" /> Reading the book from the enclave and checking every link…</p>}
      {err && <p className="note" role="alert" data-testid="key-error" style={{ color: "var(--coral)" }}>{err}</p>}
      {legacy !== null && (
        <section className="card" data-testid="key-legacy">
          <h2>KEYHOLE Key #{legacy}</h2>
          <p>An early key, minted before per-key history books existed. Its owner is still on chain: see <span className="mono">nft_token</span> on <TxLink account="keyhole-devmo.near" />.</p>
        </section>
      )}
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
                  <span className="mono"><TxLink account={h.owner}>{short(h.owner)}</TxLink></span>
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
                <li key={e.i}><b>{e.kind}</b><span className="mono"><TxLink account={e.owner}>{short(e.owner)}</TxLink></span><span>{when(e.ts_ms)}</span><span className="mono h" title={`log entry hash ${e.hash}`}>{e.hash.slice(0, 12)}… <CopyBtn value={e.hash} label="Copy hash" /></span></li>
              ))}
            </ol>
            <p className="mono khead">head {body.head} <CopyBtn value={body.head} label="Copy" /></p>
            <p className="note">Each entry hash covers the previous one, so changing any row breaks every hash after it. These are log hashes, not chain transactions.</p>
          </section>
        </>
      )}
    </div>
  );
}
