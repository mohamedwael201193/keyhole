"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { decodeShare, minterIsContracts, parseStatement, sigValid, usd, type PnlShare, type PnlStatement } from "@/lib/pnl";
import { KEYS_CONTRACT } from "@/lib/config";
import { Card, Button } from "@/components/ui";

type State = { share: PnlShare; st: PnlStatement | null; sig: boolean; minter: boolean | null } | "none" | "bad";

/** Signed swap log: enclave-signed mark-to-market of trade outputs vs cost. Not realized profit. Browser-checked. */
export function PnlView() {
  const [s, setS] = useState<State | null>(null);
  useEffect(() => {
    const load = () => {
      const share = decodeShare(window.location.hash);
      if (!window.location.hash) { setS("none"); return; }
      if (!share) { setS("bad"); return; }
      const base = { share, st: parseStatement(share.statement), sig: sigValid(share), minter: null };
      setS(base);
      void minterIsContracts(share.minter).then((m) => setS({ ...base, minter: m }));
    };
    load();
    addEventListener("hashchange", load);
    return () => removeEventListener("hashchange", load);
  }, []);
  const ok = s && typeof s === "object" && s.sig && s.minter === true && !!s.st;
  return (
    <div className="page pnl" data-testid="pnl-page">
      <header className="pnl-head">
        <p className="eb">Signed swap log · opt-in · verified in your browser</p>
        <h1>A signed swap log <em>you can check.</em></h1>
        <p className="lead">A key holder chose to publish this. The enclave read that holder&apos;s trade log, marked each trade&apos;s <em>output</em> to market now, and signed the totals with the minter key. This is a swap log delta (outputs vs cost), <b>not realized profit</b>. No balances or per-trade amounts are in it.</p>
      </header>

      {s === "none" && (
        <Card className="pnl-note" testid="pnl-none">
          <h2>No statement in this link</h2>
          <p>A holder creates one from <Link href="/vault">the vault</Link>: Activity, then <b>Publish signed swap log</b>.</p>
          <div className="pnl-actions"><Button href="/vault" variant="secondary">Open a vault</Button></div>
        </Card>
      )}
      {s === "bad" && (
        <Card className="pnl-note" testid="pnl-bad">
          <h2>Not a readable statement</h2>
          <p>This link does not contain a readable statement. Ask the holder for a new link.</p>
        </Card>
      )}

      {s && typeof s === "object" && (
        <>
          <Card size="lg" className="pnl-figure" testid="pnl-card">
            <span className="pnl-figure-l">Mark-to-market delta (not profit)</span>
            <span className="pnl-figure-v">{s.st ? usd(s.st.pnl_usd_micro) : "—"}</span>
            {s.st && (
              <dl className="pnl-grid">
                <div><dt>Key</dt><dd className="mono">{s.st.token_id}</dd></div>
                <div><dt>Holder</dt><dd className="mono">{s.st.owner}</dd></div>
                <div><dt>Lifetime trades (this key, this holder)</dt><dd>{s.st.trades}</dd></div>
                <div><dt>Paid at trade time</dt><dd>{usd(s.st.cost_usd_micro)}</dd></div>
                <div><dt>Outputs worth now</dt><dd>{usd(s.st.value_now_usd_micro)}</dd></div>
                <div><dt>Since</dt><dd>{s.st.since_ms ? new Date(s.st.since_ms).toUTCString() : "—"}</dd></div>
                <div><dt>Signed at</dt><dd>{new Date(s.st.ts_ms).toUTCString()}</dd></div>
                <div><dt>Method</dt><dd>{s.st.method}</dd></div>
              </dl>
            )}
          </Card>

          <ol className="pnl-checks">
            <li className="kh-card" data-testid="pnl-sig" data-pass={String(s.sig)}>
              <span className={`pnl-mark ${s.sig ? "ok" : "bad"}`} aria-hidden="true">{s.sig ? "✓" : "✕"}</span>
              <div>
                <h2>Signature valid</h2>
                <p>ed25519 over the exact statement bytes, checked against <span className="mono">{s.share.minter.slice(0, 12)}…</span> in your browser.</p>
              </div>
            </li>
            <li className="kh-card" data-testid="pnl-minter" data-pass={String(s.minter)}>
              <span className={`pnl-mark ${s.minter == null ? "wait" : s.minter ? "ok" : "bad"}`} aria-hidden="true">{s.minter == null ? "…" : s.minter ? "✓" : "✕"}</span>
              <div>
                <h2>Signer is the contract&apos;s minter</h2>
                <p><span className="mono">{KEYS_CONTRACT}</span> config names this account as minter, and that key exists only inside the enclave.</p>
              </div>
            </li>
            <li className="kh-card">
              <span className={`pnl-mark ${s.share.call_id ? "link" : "wait"}`} aria-hidden="true">{s.share.call_id ? "→" : "–"}</span>
              <div>
                <h2>Attested call</h2>
                {/* A pointer, not a verdict: TxResult would read as "Confirmed", so this stays a plain link. */}
                {s.share.call_id ? (
                  <p>The statement is in the output of <Link href={`/verify?call=${s.share.call_id}`} className="pnl-link">call {s.share.call_id.slice(0, 8)}</Link>. Paste this statement JSON there to match it to the attested output hash.</p>
                ) : <p>No call id was attached to this statement.</p>}
              </div>
            </li>
          </ol>

          <p className={`pnl-verdict ${ok ? "ok" : "bad"}`} data-testid="pnl-verdict" data-ok={ok ? "true" : "false"}>
            {ok ? "Verified: signed by the KEYHOLE enclave minter." : s.minter == null ? "Checking…" : "Not verified."}
          </p>
          <details className="pnl-json">
            <summary>Statement JSON</summary>
            <pre className="term pnl-raw">{s.share.statement}</pre>
          </details>
        </>
      )}
    </div>
  );
}
