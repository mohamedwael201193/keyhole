"use client";
import { CopyBtn } from "@/components/ui";
import { InCardFailure, Details } from "@/components/InCard";
import { notSentView } from "@/lib/opResult";

/**
 * The card for a value operation that was not admitted or has no final answer: one plain line (nothing was sent, no funds moved),
 * the one next step, and the reference with a copy button in a collapsed Details. Never a bare UNKNOWN.
 */
export function OpNotSent({ code, message, noun, knownOpId, testid = "op-not-sent" }: { code: string; message?: string | null; noun: string; knownOpId?: string | null; testid?: string }) {
  const v = notSentView(code, message, noun, knownOpId);
  return (
    <InCardFailure testid={testid} reason={<><b id={`${testid}-h`}>{v.headline}.</b> No funds moved.</>}>
      <p className="ic-note" data-testid={`${testid}-next`}><b>Next step.</b> {v.nextStep}</p>
      <Details testid={`${testid}-details`}>
        <p className="ic-note" data-testid={`${testid}-status`}>Not sent yet, and no final answer. {v.detail}</p>
        <p className="ic-note">This attempt produced no transaction.</p>
        {v.opId && (
          <p className="ic-note" data-testid={`${testid}-opid`}>
            Reference <code style={{ overflowWrap: "anywhere" }}>{v.opId}</code> <CopyBtn value={v.opId} label="Copy reference" />
          </p>
        )}
      </Details>
    </InCardFailure>
  );
}
