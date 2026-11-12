"use client";
import Link from "next/link";
import { Button } from "@/components/ui";
import { InCardSuccess, Details } from "@/components/InCard";
import { intentTx } from "@/lib/config";
import type { SwapOutcome } from "./progress";
import { dashHref } from "@/lib/dashboardSections";

/**
 * The finished swap, in place inside the swap card: a check mark, the amount, the word from the enclave's status ("Settled")
 * and a transaction link. A swap that is still on its way or was refunded keeps its own plain word. Everything technical is in
 * Details. Nothing here is computed beyond formatting: the amounts and hashes come from the enclave's answer.
 */
export function SwapDone({ outcome, summary, status, requestId, intentHash, callId, minOut, onAgain, testid = "trade-out" }: {
  outcome: SwapOutcome;
  /** The trade in one line, from lib/amount tradeSummary. */
  summary: string;
  /** The raw status word the enclave returned, or null. */
  status: string | null;
  requestId?: string | null;
  intentHash?: string | null;
  callId?: string | null;
  minOut?: string | null;
  onAgain: () => void;
  testid?: string;
}) {
  const settled = outcome.tone === "success";
  return (
    <InCardSuccess
      testid={testid}
      status={status ?? undefined}
      amount={summary || outcome.headline}
      title={outcome.chip}
      link={intentHash ? { href: intentTx(intentHash), label: "View transaction", testid: "swap-intent-link" } : null}
      actions={<>
        <Button variant="primary" size="sm" onClick={onAgain} testid="swap-again">Swap again</Button>
        <Button variant="secondary" size="sm" href={dashHref("/settle")} testid="swap-activity">View in Activity</Button>
      </>}
    >
      {!settled && <p className="ic-note">{outcome.where}</p>}
      <Details testid="swap-done-facts">
        <dl className="sw-facts">
          <div><dt>Status</dt><dd><code>{status ?? "not shown"}</code></dd></div>
          {minOut && <div><dt>Minimum received</dt><dd>{minOut}</dd></div>}
          {requestId && <div><dt>Request</dt><dd><code>{requestId}</code></dd></div>}
          {intentHash && <div><dt>Intent</dt><dd><code title={intentHash}>{`${intentHash.slice(0, 8)}…${intentHash.slice(-4)}`}</code></dd></div>}
        </dl>
        {callId && <p className="ic-note"><Link href={dashHref(`/verify?call=${encodeURIComponent(callId)}`)} data-testid="swap-verify-link">See your proof</Link></p>}
      </Details>
    </InCardSuccess>
  );
}
