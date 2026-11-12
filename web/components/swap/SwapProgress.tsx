"use client";
import { errorText } from "@/lib/i18n";
import type { ProgressStep } from "@/components/v7";
import { OpNotSent } from "@/components/OpNotSent";
import { InCardFailure, InCardProgress } from "@/components/InCard";
import { isNotSent } from "@/lib/opResult";

/**
 * The live panel while a signed swap runs, inside the swap card. The steps come from the real stage (components/swap/progress.ts);
 * `line` is the real busy line from useSigned. Replaces the form inside the card.
 */
export function SwapRunning({ title, line, steps }: { title: string; line: string; steps: ProgressStep[] }) {
  return <InCardProgress title={title.endsWith("…") ? title : `${title}…`} line={line} steps={steps} testid="trade-pending" />;
}

/**
 * The swap did not complete: one plain line with the reason and one button for the next step. A swap that was not admitted is never
 * retried from here (the earlier operation is confirmed first), so it offers only the way back. Technical detail is in Details.
 */
export function SwapFailed({ steps, stoppedAt, code, retryAfter, message, knownOpId, onRetry, onBack }: {
  steps: ProgressStep[];
  /** The plain name of the step that stopped, for example "Confirm in your wallet". */
  stoppedAt: string;
  code: string;
  retryAfter?: number;
  /** The worker's message, which names the original operation id for an unconfirmed swap. */
  message?: string;
  /** The newest unfinished operation id kept in this browser. */
  knownOpId?: string | null;
  onRetry: () => void;
  onBack: () => void;
}) {
  const notSent = isNotSent(code);
  if (notSent) {
    return (
      <div data-testid="trade-failed">
        <OpNotSent code={code} message={message} noun="swap" knownOpId={knownOpId} testid="swap-not-sent" />
        <p className="ic-actions"><button type="button" className="kh-btn kh-btn--secondary kh-btn--sm" onClick={onBack} data-testid="swap-back">Back to swap</button></p>
      </div>
    );
  }
  const [reason] = errorText(code, { s: retryAfter ?? 0 });
  return (
    <InCardFailure reason={reason} action={{ label: "Try again", onClick: onRetry, testid: "swap-retry" }}>
      <button type="button" className="ic-textbtn" onClick={onBack} data-testid="swap-back">Back to swap</button>
      <details className="kh-details" data-testid="trade-failed-details"><summary>Details</summary><p>Stopped at: {stoppedAt}. Reference: <code>{code}</code></p></details>
    </InCardFailure>
  );
}
