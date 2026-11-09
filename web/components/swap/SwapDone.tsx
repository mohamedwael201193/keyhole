"use client";
import Link from "next/link";
import { SuccessCheck } from "@/components/motion";
import { Button } from "@/components/ui";
import { Icon, StatusChip } from "@/components/v7";
import { intentTx } from "@/lib/config";
import type { SwapOutcome } from "./progress";

/**
 * The finished swap: the real summary line (tradeSummary), the status chip from the enclave's status word, the facts it returned,
 * explorer pills from the real hashes (the intents explorer for the intent, /verify for the attested call) and two actions.
 * Nothing here is computed beyond formatting: the amounts and hashes come from the enclave's answer.
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
  return (
    <section className="sw-phase sw-done" data-testid={testid} data-status={status ?? undefined} aria-labelledby="sw-done-h">
      <div className="sw-phase-head">
        <span className="sw-done-check" aria-hidden="true"><SuccessCheck size={44} /></span>
        <div className="sw-phase-text">
          <h3 id="sw-done-h" className="sw-phase-title">{outcome.headline}</h3>
          <p className="sw-phase-sum">{summary}</p>
        </div>
      </div>
      <div className="sw-done-meta">
        <StatusChip tone={outcome.tone} icon={outcome.icon === "check" ? "check" : "dot"} testid="swap-status">{outcome.chip}</StatusChip>
        <span className="sw-done-where">{outcome.where}</span>
      </div>
      <dl className="sw-facts" data-testid="swap-done-facts">
        <div><dt>Status</dt><dd><code>{status ?? "not shown"}</code></dd></div>
        {minOut && <div><dt>Minimum received</dt><dd>{minOut}</dd></div>}
        {requestId && <div><dt>Request</dt><dd><code>{requestId}</code></dd></div>}
        {intentHash && <div><dt>Intent</dt><dd><code title={intentHash}>{`${intentHash.slice(0, 8)}…${intentHash.slice(-4)}`}</code></dd></div>}
      </dl>
      {(intentHash || callId) && (
        <div className="sw-pills">
          {intentHash && (
            <a className="v7-pill-link" href={intentTx(intentHash)} target="_blank" rel="noreferrer" data-testid="swap-intent-link">
              <span>Intents explorer</span>
              <Icon name="external" size={14} />
              <span className="v7-sr-only"> (opens in a new tab)</span>
            </a>
          )}
          {callId && (
            <Link className="v7-pill-link" href={`/verify?call=${encodeURIComponent(callId)}`} data-testid="swap-verify-link">
              <span>Verify the call</span>
              <Icon name="arrow-right" size={14} />
            </Link>
          )}
        </div>
      )}
      <div className="sw-actions">
        <Button variant="primary" onClick={onAgain} testid="swap-again">Swap again</Button>
        <Button variant="secondary" href="/settle" testid="swap-activity">View in Activity</Button>
      </div>
    </section>
  );
}
