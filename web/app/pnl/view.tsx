"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { decodeShare, minterIsContracts, parseStatement, sigValid, usd, type PnlShare, type PnlStatement } from "@/lib/pnl";
import { KEYS_CONTRACT } from "@/lib/config";

type State = { share: PnlShare; st: PnlStatement | null; sig: boolean; minter: boolean | null } | "none" | "bad";

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
    <div className="page judge pnl" data-testid="pnl-page">
      <p className="eb">Signed PnL · opt-in · verified in your browser</p>
      <h1>A track record <em>you can check.</em></h1>
      <p className="lede">A key holder chose to publish this. The enclave read its own trade log for that holder, priced each trade&apos;s output now, and signed the totals with the minter key the NFT contract names. No balances, assets or per-trade amounts are in it.</p>
      {s === "none" && <div className="c jlimits"><p>No statement in this link. A holder creates one from <Link href="/vault">/vault</Link> → Activity → <b>Publish signed PnL</b>.</p></div>}
      {s === "bad" && <div className="c jlimits" data-testid="pnl-bad"><p>This link does not contain a readable statement.</p></div>}
      {s && typeof s === "object" && (
        <>
          <div className="c jlimits" data-testid="pnl-card">
            <h2>{s.st ? usd(s.st.pnl_usd_micro) : "—"} <span className="mono muted" style={{ fontSize: 14 }}>PnL</span></h2>
            {s.st && (
              <dl className="kv">
                <dt>key</dt><dd className="mono">{s.st.token_id}</dd>
                <dt>holder</dt><dd className="mono" style={{ overflowWrap: "anywhere" }}>{s.st.owner}</dd>
                <dt>lifetime trades (this key, this holder)</dt><dd>{s.st.trades}</dd>
                <dt>paid at trade time</dt><dd>{usd(s.st.cost_usd_micro)}</dd>
                <dt>outputs worth now</dt><dd>{usd(s.st.value_now_usd_micro)}</dd>
                <dt>since</dt><dd>{s.st.since_ms ? new Date(s.st.since_ms).toUTCString() : "—"}</dd>
                <dt>signed at</dt><dd>{new Date(s.st.ts_ms).toUTCString()}</dd>
                <dt>method</dt><dd>{s.st.method}</dd>
              </dl>
            )}
          </div>
          <ol className="jsteps">
            <li className="c" data-testid="pnl-sig" data-pass={String(s.sig)}><h2><span>{s.sig ? "✓" : "✕"}</span>Signature valid</h2><p>ed25519 over the exact statement bytes, checked against <span className="mono">{s.share.minter.slice(0, 12)}…</span> in your browser.</p></li>
            <li className="c" data-testid="pnl-minter" data-pass={String(s.minter)}><h2><span>{s.minter == null ? "…" : s.minter ? "✓" : "✕"}</span>Signer is the contract&apos;s minter</h2><p><span className="mono">{KEYS_CONTRACT}</span> config names this account as minter, and that key exists only inside the enclave.</p></li>
            <li className="c"><h2><span>{s.share.call_id ? "→" : "–"}</span>Attested call</h2><p>{s.share.call_id ? <>The statement is in the output of <Link href={`/verify?call=${s.share.call_id}`}>call {s.share.call_id.slice(0, 8)}</Link>; paste this statement JSON there to match it to the attested output hash.</> : "No call id was attached."}</p></li>
          </ol>
          <p className="mono" data-testid="pnl-verdict" data-ok={ok ? "true" : "false"}>{ok ? "Verified: signed by the KEYHOLE enclave minter." : s.minter == null ? "Checking…" : "Not verified."}</p>
          <details><summary>Statement JSON</summary><pre className="term" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{s.share.statement}</pre></details>
        </>
      )}
    </div>
  );
}
