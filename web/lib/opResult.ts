/**
 * What a value operation that did not complete means for the holder, in plain words. Pure rules, no I/O.
 * The worker answers a money operation it cannot confirm with admission_unknown ("no confirmed matching pending admission; do not
 * dispatch"), refuses a second one with value_op_pending or replay, and names the original operation id in the message
 * ("reconcile operation 1:<64 hex>"). Those are "not sent / not admitted" states: no transaction hash exists, and the next step is to
 * check the original operation, never to send it again.
 */
const OP_ID = /([1-9]\d{0,19}:[0-9a-f]{64})/;

/** Codes that mean the operation was not admitted or is not final: nothing is retried, the original is checked. */
export const NOT_SENT_CODES = ["admission_unknown", "value_op_pending", "replay", "guard_journal", "transfer_pending"] as const;
export const isNotSent = (code: string | null | undefined): boolean => !!code && (NOT_SENT_CODES as readonly string[]).includes(code);

/** The original operation id named in a worker message, or null. */
export function opIdFrom(message: string | null | undefined): string | null {
  return message ? (OP_ID.exec(message)?.[1] ?? null) : null;
}

export type NotSentView = {
  headline: string;
  detail: string;
  nextStep: string;
  /** The operation id to show. It is a journal id, not a transaction hash. */
  opId: string | null;
};

/** `noun` is the thing the holder tried: "swap", "withdrawal". `known` is the newest recovery id from this browser, used when the message names none. */
export function notSentView(code: string, message: string | null | undefined, noun: string, known?: string | null): NotSentView {
  const opId = opIdFrom(message) ?? known ?? null;
  const detail = code === "admission_unknown"
    ? `The enclave could not confirm this ${noun} on chain, so it did not dispatch it. This attempt produced no transaction.`
    : code === "value_op_pending"
      ? `An earlier operation on this key is still pending, so this ${noun} was not started.`
      : `This ${noun} was not started, because an earlier one has no final answer yet.`;
  const nextStep = "Check the original operation in Account operation recovery (one wallet signature). An earlier UNKNOWN operation clears only after the worker's reconcile confirms it; until then swaps, withdrawals and transfers stay locked. Do not try again before that.";
  return { headline: `${noun[0].toUpperCase()}${noun.slice(1)} not sent`, detail, nextStep, opId };
}
