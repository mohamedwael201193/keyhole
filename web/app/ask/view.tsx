"use client";
import { useState } from "react";
import Link from "next/link";
import { AI_MAX_PROMPT, AI_MODEL, allPass, answerOf, checkReply, newNonce, type AiChecks, type AiReply } from "@/lib/ai";

const ROWS: [keyof AiChecks, string, string][] = [
  ["nonceInQuote", "Fresh nonce in the TDX quote", "Your browser made this nonce; the quote's report_data ends with it, so the report was produced for this question."],
  ["signerInQuote", "Signing key bound in the quote", "report_data starts with the model's signing address, so that key lives in the attested enclave."],
  ["nonceEcho", "Nonce echoed", "The report says it answered this nonce."],
  ["requestHash", "Your request is what was signed", "sha256 of the exact request bytes equals the hash the model signed."],
  ["responseHash", "This answer is what was signed", "sha256 of the exact response bytes equals the hash the model signed. The answer below is read from those bytes."],
  ["modelMatch", "Model matches", `Signed text, report and request all name ${AI_MODEL}.`],
  ["signatureValid", "Signature recovers the attested key", "ECDSA (EIP-191) recovery in your browser gives the address bound in the quote."],
];

export function AskView() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reply, setReply] = useState<AiReply | null>(null);
  const [nonce, setNonce] = useState<string | null>(null);
  const [checks, setChecks] = useState<AiChecks | null>(null);
  const ask = async () => {
    const q = prompt.trim();
    if (!q || busy) return;
    setBusy(true); setErr(null); setReply(null); setChecks(null);
    const n = newNonce();
    setNonce(n);
    try {
      const r = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: q, nonce: n }) });
      const j = await r.json();
      if (!j.ok) { setErr(j.error?.code === "rate_limited" ? `Too many questions. Try again in ${j.error.retry_after ?? 60} s.` : j.error?.code === "ai_offline" ? "The assistant is offline." : "The model could not answer right now."); return; }
      setReply(j as AiReply);
      setChecks(await checkReply(j as AiReply, n));
    } catch { setErr("The model could not answer right now."); }
    finally { setBusy(false); }
  };
  const verified = checks ? allPass(checks) : false;
  const download = () => {
    if (!reply) return;
    const blob = new Blob([JSON.stringify({ nonce, ...reply }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `keyhole-ai-evidence-${nonce?.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="page ask" data-testid="ask-page">
      <p className="eb">Private assistant · NEAR AI Cloud · TEE</p>
      <h1>Ask privately. <em>Check the enclave.</em></h1>
      <p className="lede">Questions go to <span className="mono">{AI_MODEL}</span>, a model NEAR AI runs inside an Intel TDX confidential VM with NVIDIA GPU attestation. Your browser makes a fresh nonce, the model&apos;s attestation is requested with it, and the answer is signed by the key that attestation binds. This site relays the question and stores nothing.</p>

      <div className="askgrid">
        <section className="c vcard">
          <form onSubmit={(e) => { e.preventDefault(); void ask(); }} className="askform">
            <label htmlFor="q">Your question</label>
            <textarea id="q" className="input" rows={4} maxLength={AI_MAX_PROMPT} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="How do holder limits work if I sell my key?" data-testid="ask-input" />
            <div className="askrow">
              <small className="mono">{prompt.length}/{AI_MAX_PROMPT}</small>
              <button className="btn b1" type="submit" disabled={busy || !prompt.trim()} data-testid="ask-btn">{busy ? "Asking the enclave…" : "Ask"}</button>
            </div>
          </form>
          {err && <p role="alert" className="note" style={{ color: "var(--coral)" }} data-testid="ask-error">{err}</p>}
          {reply && (
            <div className="answer" data-testid="ask-answer">
              <p className="mono cap">Answer</p>
              <p>{answerOf(reply) || "(empty answer)"}</p>
            </div>
          )}
          <ul className="asknotes">
            <li>Short questions only ({AI_MAX_PROMPT} characters), a few per minute. Not financial advice.</li>
            <li>Never paste a seed phrase or private key. Nothing here needs one.</li>
            <li>This site keeps no logs or copies of questions or answers. NEAR AI&apos;s private inference runs the model inside the TEE.</li>
          </ul>
        </section>

        <section className={`c vcard verified${verified ? " ok" : ""}`} data-testid="ask-verified">
          <header className="vhd"><h2>Verified</h2>{checks ? <span className={`vbadge ${verified ? "ok" : "lock"}`} data-testid="ask-verdict" data-ok={verified ? "true" : "false"}><i />{verified ? "All checks pass" : "Check failed"}</span> : <span className="vbadge mute"><i />Waiting for a question</span>}</header>
          {nonce && <p className="mono small">nonce {nonce.slice(0, 16)}…{nonce.slice(-8)}</p>}
          <ol className="askchecks">
            {ROWS.map(([k, title, desc]) => (
              <li key={k} data-pass={checks ? String(checks[k]) : "wait"}>
                <span className="dot">{checks ? (checks[k] ? "✓" : "✕") : "·"}</span>
                <div><b>{title}</b><small>{desc}</small></div>
              </li>
            ))}
          </ol>
          {reply && (
            <dl className="kv">
              <dt>signing address</dt><dd className="mono" data-kind="hash">{reply.attestation.signing_address}</dd>
              <dt>signed text</dt><dd className="mono" data-kind="hash">{reply.signature.text}</dd>
              <dt>GPU evidence</dt><dd>{reply.attestation.gpu_evidence ? "NVIDIA payload present" : "none"}</dd>
            </dl>
          )}
          <p className="asknote">Your browser checks the bindings above. It does not check the Intel and NVIDIA certificate chains of the quote itself; download the evidence and run NEAR AI&apos;s verifier for that (<a href="https://docs.near.ai/cloud/verification/cloud-api/model-attestations" target="_blank" rel="noreferrer">how</a>).</p>
          {reply && <button className="btn b2" onClick={download} data-testid="ask-download">Download evidence (JSON)</button>}
        </section>
      </div>
      <p className="asknote">Enclave answers about your own account come from the KEYHOLE worker and are checked on <Link href="/verify">/verify</Link>.</p>
    </div>
  );
}
