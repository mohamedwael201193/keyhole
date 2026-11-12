"use client";
import { CopyBtn } from "@/components/ui";
import { notSentView } from "@/lib/opResult";

/**
 * The honest card for a value operation that was not admitted or has no final answer: what happened, that no transaction hash
 * exists, the operation id (a journal id, not a hash) with a copy button, and the one next step. Never a bare UNKNOWN.
 */
export function OpNotSent({ code, message, noun, knownOpId, testid = "op-not-sent" }: { code: string; message?: string | null; noun: string; knownOpId?: string | null; testid?: string }) {
  const v = notSentView(code, message, noun, knownOpId);
  return (
    <section className="kh-tx op-notsent" data-state="not-sent" data-testid={testid} role="alert" aria-labelledby={`${testid}-h`}>
      <div className="kh-tx-head"><b id={`${testid}-h`}>{v.headline}</b></div>
      <p className="note">{v.detail}</p>
      <div className="kh-tx-row"><span>Status</span><span data-testid={`${testid}-status`}>Not admitted · no final answer</span></div>
      <div className="kh-tx-row"><span>Transaction</span><span>None was produced</span></div>
      {v.opId && (
        <div className="kh-tx-row" data-testid={`${testid}-opid`}>
          <span>Operation id</span>
          <code style={{ overflowWrap: "anywhere" }}>{v.opId}</code>
          <CopyBtn value={v.opId} label="Copy operation id" />
        </div>
      )}
      <p className="note" data-testid={`${testid}-next`}><b>Next step.</b> {v.nextStep}</p>
    </section>
  );
}
