"use client";
import { useState } from "react";
import { PageHeader } from "@/components/v7";
import { EvidenceTable } from "@/components/judge/EvidenceTable";
import { CallVerifier, TOTAL_CHECKS } from "@/components/judge/CallVerifier";
import { LienPanel } from "@/components/lien/LienPanel";
import { KEY_ID_RE, useLien } from "@/components/lien/useLien";
import "./verify.css";

export { TOTAL_CHECKS };

/** Lien lookup: a key id in, its lien facts out (read-only views on the final chain, no wallet). */
function LienLookup() {
  const [draft, setDraft] = useState("");
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [lookup, setLookup] = useState(0);
  const lien = useLien(tokenId, { marker: lookup });
  const bad = tokenId !== null && !KEY_ID_RE.test(tokenId);
  return (
    <section id="lien-check" className="vf-lien" aria-label="Lien check" data-testid="lien-check">
      <form className="vf-lien-form" onSubmit={(e) => { e.preventDefault(); setTokenId(draft.trim()); setLookup((n) => n + 1); }}>
        <label htmlFor="lien-id">Key id</label>
        <input id="lien-id" className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="k + 16 hex characters" spellCheck={false} />
        <button type="submit" className="kh-btn kh-btn--secondary kh-btn--sm" disabled={!draft.trim()}>{draft.trim() ? "Read lien" : "Enter a key id first"}</button>
      </form>
      <p className="lien-note">Reads the key&apos;s owner, lien state, loan terms and refusal rules from the final chain. Nothing is signed. Paste a key id, for example k5f4750858f328940 or 0.</p>
      {bad && <p className="lien-note" role="alert">That is not a key id. Use k plus 16 lowercase hex characters, like k5f4750858f328940.</p>}
      {!bad && tokenId && <LienPanel lien={lien} testid="verify-lien" />}
    </section>
  );
}

/**
 * Judge proof desk (app shell). Primary action: live evidence pack.
 * Secondary: re-check one TEE call (existing 36-check verifier).
 */
export function VerifyView({ initial }: { initial: string | null }) {
  return (
    <div className="kp-root vf-page" data-testid="verify-page">
      <PageHeader
        eyebrow="Proof"
        title={<>Re-check KEYHOLE on <em>mainnet</em>.</>}
        lead="No wallet. Each row below hits a public RPC or attestation API and shows PASS or FAIL."
        actions={<a className="kh-btn kh-btn--secondary kh-btn--sm" href="#tee-call">Check one TEE call</a>}
        testid="verify-head"
      />
      <LienLookup />
      <EvidenceTable />
      <section id="tee-call" className="vf-tee" aria-label="TEE call verifier">
        <CallVerifier initial={initial} />
      </section>
    </div>
  );
}
