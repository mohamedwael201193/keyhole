"use client";
import { errorText } from "@/lib/i18n";
import type { ProgressStep } from "@/components/v7";
import { OpNotSent } from "@/components/OpNotSent";
import { InCardFailure, InCardProgress } from "@/components/InCard";
import { gateRefusalFrom, isGateRefusal, isNotSent } from "@/lib/opResult";
import { dashHref } from "@/lib/dashboardSections";
import { tx } from "@/lib/config";

/**
 * The plain in-card message for a swap the enclave refused or left pending because an earlier transaction is
 * still confirming: no internal terms, no "Network error". (Claude, brief v2 answers.)
 */
export const PAUSED_MESSAGE = "Swaps are paused while an earlier transaction confirms. Nothing was sent.";
/** A failed attempt that broadcast nothing still holds part of today's limit until the 00:00 UTC reset. */
export const CAP_NOTE = "A failed attempt may hold part of today's limit until 00:00 UTC. Check the Today meter on the Vault page.";

/**
 * The live panel while a signed swap runs, inside the swap card. The steps come from the real stage (components/swap/progress.ts);
 * `line` is the real busy line from useSigned. Replaces the form inside the card.
 */
export function SwapRunning({ title, line, steps }: { title: string; line: string; steps: ProgressStep[] }) {
  return <InCardProgress title={title.endsWith("…") ? title : `${title}…`} line={line} steps={steps} testid="trade-pending" />;
}

/**
 * The balance before and after a failed attempt, in one plain line. "Nothing moved" is claimed only when the two
 * figures are equal; when they differ the figures speak for themselves, and when the re-read has not landed yet the
 * line says the balance is being checked instead of guessing.
 */
function BalanceLine({ before, after }: { before?: string | null; after?: string | null }) {
  if (!before && !after) return null;
  if (before && after) {
    return <p className="ic-note" data-testid="swap-balance-line">Balance before this attempt: {before}. Balance now: {after}.{before === after ? " Nothing moved." : ""}</p>;
  }
  if (before) return <p className="ic-note" data-testid="swap-balance-line">Balance before this attempt: {before}. Checking the balance now…</p>;
  return <p className="ic-note" data-testid="swap-balance-line">Balance now: {after}.</p>;
}

/**
 * The swap did not complete: one plain line with the reason and one button for the next step. A swap that was not admitted is never
 * retried from here (the earlier operation is confirmed first), so it offers only the way back. Technical detail is in Details.
 *
 * A refusal before sending is a different failure from an unknown outcome, and the card says which one it is: when the
 * enclave refused the swap because an earlier operation is still open, the card says so in plain words ("Swaps are
 * paused while an earlier transaction confirms. Nothing was sent."), names that earlier operation (its reference
 * block and transaction, with an explorer link), the amount attempted, and the balance before and after — and "Try
 * again" is a quiet secondary, because retrying while the earlier operation is open sends nothing. A failed attempt
 * may hold part of today's limit until 00:00 UTC. For a genuinely unknown outcome the primary action is the proof
 * of the attempt (the call id), with "Try again" beside it; when no hash came back, the card says honestly that no
 * transaction was broadcast and nothing moved.
 */
export function SwapFailed({ steps, stoppedAt, code, retryAfter, message, knownOpId, callId, amount, balanceBefore, balanceAfter, onRetry, onBack }: {
  steps: ProgressStep[];
  /** The plain name of the step that stopped, for example "Confirm in your wallet". */
  stoppedAt: string;
  code: string;
  retryAfter?: number;
  /** The worker's message, which names the original operation id for an unconfirmed swap. */
  message?: string;
  /** The newest unfinished operation id kept in this browser. */
  knownOpId?: string | null;
  /** The failed attempt's own call id: the proof link. Absent when the attempt never produced a call. */
  callId?: string | null;
  /** The amount attempted, for example "0.01 USDC". */
  amount?: string | null;
  /** The pay-token balance when the swap was sent, and the balance after the failure re-read. */
  balanceBefore?: string | null;
  balanceAfter?: string | null;
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
  if (isGateRefusal(code, message)) {
    const ref = gateRefusalFrom(message);
    return (
        <InCardFailure
          testid="trade-failed"
          reason={<><b>{PAUSED_MESSAGE}</b></>}
          action={callId
            ? { label: "View proof", href: dashHref(`/verify?call=${encodeURIComponent(callId)}`), testid: "swap-proof" }
            : { label: "Try again", onClick: onRetry, testid: "swap-retry" }}
        >
          {amount && <p className="ic-note" data-testid="swap-refused-amount">Attempted: {amount}.</p>}
          {ref.refHeight && <p className="ic-note" data-testid="swap-refused-ref">The earlier operation is at reference block {ref.refHeight}.</p>}
          {ref.txHash && <p className="ic-note" data-testid="swap-refused-tx">Earlier transaction: <a href={tx(ref.txHash)} target="_blank" rel="noreferrer">{ref.txHash}</a></p>}
          <BalanceLine before={balanceBefore} after={balanceAfter} />
          <p className="ic-note" data-testid="swap-refused-cap">{CAP_NOTE}</p>
          <p className="ic-actions">
            {callId && <button type="button" className="kh-btn kh-btn--secondary kh-btn--sm" onClick={onRetry} data-testid="swap-retry">Try again</button>}
            <button type="button" className="ic-textbtn" onClick={onBack} data-testid="swap-back">Back to swap</button>
          </p>
          <details className="kh-details" data-testid="trade-failed-details"><summary>Details</summary>
            <p>Stopped at: {stoppedAt}. Reference: <code>{code}</code></p>
            {ref.txHash && <p>Earlier transaction: <code>{ref.txHash}</code></p>}
            {callId && <p>Call: <code>{callId}</code></p>}
          </details>
        </InCardFailure>
    );
  }
  // A refusal or pending outcome that did not carry the gate message still means the same thing: an earlier
  // transaction is confirming, so this swap was not sent. A gateway failure with no hash means nothing was
  // broadcast at all. Neither shows an internal code or "Network error" as the reason.
  const paused = code === "native_blocked" || code === "native_unknown" || code === "pending" || code === "value_op_pending";
  const noBroadcast = code === "network" || code === "gateway";
  const reason = paused ? PAUSED_MESSAGE : noBroadcast ? "No transaction was broadcast — nothing moved." : errorText(code, { s: retryAfter ?? 0 })[0];
  return (
      <InCardFailure
        reason={reason}
        action={callId
          ? { label: "View proof", href: dashHref(`/verify?call=${encodeURIComponent(callId)}`), testid: "swap-proof" }
          : { label: "Try again", onClick: onRetry, testid: "swap-retry" }}
      >
        <BalanceLine before={balanceBefore} after={balanceAfter} />
        <p className="ic-note" data-testid="swap-failed-cap">{CAP_NOTE}</p>
        <p className="ic-actions">
          {callId && <button type="button" className="kh-btn kh-btn--secondary kh-btn--sm" onClick={onRetry} data-testid="swap-retry">Try again</button>}
          <button type="button" className="ic-textbtn" onClick={onBack} data-testid="swap-back">Back to swap</button>
        </p>
        <details className="kh-details" data-testid="trade-failed-details"><summary>Details</summary><p>Stopped at: {stoppedAt}. Reference: <code>{code}</code></p>{callId && <p>Call: <code>{callId}</code></p>}</details>
      </InCardFailure>
  );
}
