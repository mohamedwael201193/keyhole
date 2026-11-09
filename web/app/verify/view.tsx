"use client";
import { PageHeader } from "@/components/v7";
import { EvidenceTable } from "@/components/judge/EvidenceTable";
import { CallVerifier, TOTAL_CHECKS } from "@/components/judge/CallVerifier";
import "./verify.css";

export { TOTAL_CHECKS };

/**
 * Judge proof desk (app shell). Primary action: live evidence pack.
 * Secondary: re-check one TEE call (existing 37-check verifier).
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
      <EvidenceTable />
      <section id="tee-call" className="vf-tee" aria-label="TEE call verifier">
        <CallVerifier initial={initial} />
      </section>
    </div>
  );
}
