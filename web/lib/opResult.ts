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

/**
 * A refusal before sending: the enclave refused a new value operation because an earlier one is still open (its
 * window has not expired), so nothing was dispatched and no transaction exists. The worker reports it as
 * native_unknown with the message "original send UNKNOWN_TRANSACTION; still within validity window, …;
 * tx_hash=<hash>; reference_block_height=<height>" (tee/worker/src/native_send.rs: unresolved_error). On a worker
 * with the cap-leak fix the same refusal arrives as native_blocked instead: the gate remaps ONLY native_unknown
 * from its own reconcile() call to native_blocked, and the new message carries the original one verbatim after
 * "cause: " ("minter journal blocked by unresolved send; nothing was sent for this request; reconcile the minter
 * send, never resend; cause: <original message>"). That message — not the code alone — is what separates a clean
 * refusal from a genuinely unknown send: a send whose outcome is really unknown says "original send not yet
 * FINAL" and carries reference_block_height=unknown instead.
 */
const GATE_REFUSAL = /still within validity window/;
const REF_HEIGHT = /reference_block_height=(\d+)/;
const REF_TX = /tx_hash=([0-9A-Za-z]+)/;
export function isGateRefusal(code: string | null | undefined, message: string | null | undefined): boolean {
  return (code === "native_unknown" || code === "native_blocked") && !!message && GATE_REFUSAL.test(message) && REF_HEIGHT.test(message);
}

/** The earlier operation a gate refusal names: its reference block height and its transaction hash, when present. */
export function gateRefusalFrom(message: string | null | undefined): { refHeight: string | null; txHash: string | null } {
  if (!message) return { refHeight: null, txHash: null };
  return { refHeight: REF_HEIGHT.exec(message)?.[1] ?? null, txHash: REF_TX.exec(message)?.[1] ?? null };
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
  const detail = code === "replay"
    ? "This signature was already used. Each request needs a fresh signature; sign again."
    : code === "admission_unknown"
      ? `The enclave could not confirm this ${noun} on chain, so it did not dispatch it. This attempt produced no transaction.`
      : code === "value_op_pending"
        ? `An earlier operation on this key is still pending, so this ${noun} was not started.`
        : `This ${noun} was not started, because an earlier one has no final answer yet.`;
  const nextStep = code === "replay"
    ? "Sign again with a fresh signature. Nothing is resent."
    : "Confirm the earlier operation first (one wallet signature). Nothing is resent, and new operations wait until it is confirmed.";
  return { headline: `${noun[0].toUpperCase()}${noun.slice(1)} not sent`, detail, nextStep, opId };
}

const TERMINAL_OK = /^(success|succeeded|completed|settled)$/i;
/**
 * How a finished withdrawal is worded. "Settled" and a transaction link need BOTH a terminal success status and a transaction hash.
 * Anything else is "Sent · confirming…" with no link, so an account page is never presented as the transaction.
 */
export function withdrawResultView(out: { status?: unknown; tx_hash?: unknown } | null | undefined): { settled: boolean; title: string; hash: string | null } {
  const hash = typeof out?.tx_hash === "string" && out.tx_hash.length > 0 ? out.tx_hash : null;
  const ok = typeof out?.status === "string" && TERMINAL_OK.test(out.status.trim());
  return ok && hash ? { settled: true, title: "Settled", hash } : { settled: false, title: "Sent · confirming…", hash: null };
}
