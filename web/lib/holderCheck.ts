/** Identity binding for the holder-proof screen. A response is shown only for the account and request that sent it. */

export type HolderBody = {
  granted?: boolean;
  account_id?: string;
  tier?: number;
  token_ids?: string[];
  key_count?: number;
  reason?: string;
};

export type HolderView =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "granted"; accountId: string; tier: number; token_ids: string[]; key_count: number }
  | { status: "denied"; accountId: string; reason: string }
  | { status: "error"; accountId: string; message: string };

export function holderResult(input: {
  requestedAccount: string;
  requestedSeq: number;
  activeAccount: string | null;
  activeSeq: number;
  aborted: boolean;
  body: HolderBody | null;
}): HolderView {
  const { requestedAccount, requestedSeq, activeAccount, activeSeq, aborted, body } = input;
  if (aborted || activeSeq !== requestedSeq || activeAccount !== requestedAccount) return { status: "idle" };
  if (body?.granted === true && typeof body.tier === "number") {
    if (body.account_id !== requestedAccount) return { status: "idle" };
    const token_ids = Array.isArray(body.token_ids) ? body.token_ids.filter((id) => typeof id === "string") : [];
    return {
      status: "granted",
      accountId: requestedAccount,
      tier: body.tier,
      token_ids,
      key_count: typeof body.key_count === "number" ? body.key_count : token_ids.length,
    };
  }
  if (body && typeof body.reason === "string") return { status: "denied", accountId: requestedAccount, reason: body.reason };
  return { status: "error", accountId: requestedAccount, message: "The gate did not answer. Try again." };
}

/** Shown when the signed POST fails and this account's check is still the one on screen. */
export const HOLDER_NETWORK_ERROR = "The holder check could not reach the gate. Try again.";

export type HolderResume =
  | { action: "ignore" }
  | { action: "wait" }
  | { action: "submit"; challenge: string };

/** A redirect return is submitted only when the signed account is the account on screen. */
export function holderResume(pending: { account_id: string; message: string } | null, activeAccount: string | null): HolderResume {
  if (!pending) return { action: "ignore" };
  let parsed: { op?: string; account_id?: string; params?: { challenge?: string } };
  try { parsed = JSON.parse(pending.message) as typeof parsed; } catch { return { action: "ignore" }; }
  if (parsed.op !== "holder_gate" || typeof parsed.params?.challenge !== "string") return { action: "ignore" };
  if (!activeAccount) return { action: "wait" };
  if (pending.account_id !== activeAccount || parsed.account_id !== activeAccount) return { action: "wait" };
  return { action: "submit", challenge: parsed.params.challenge };
}

/**
 * One signed check. `current` is read after the response so a switch to another account, or a disconnect, drops it.
 * The caller still ignores the result when the sequence moved on.
 */
export async function settleHolderCheck(input: {
  requestedAccount: string;
  requestedSeq: number;
  signal: AbortSignal;
  current: () => { account: string | null; seq: number };
  send: (signal: AbortSignal) => Promise<{ body: HolderBody | null }>;
}): Promise<HolderView> {
  try {
    const res = await input.send(input.signal);
    const now = input.current();
    return holderResult({
      requestedAccount: input.requestedAccount,
      requestedSeq: input.requestedSeq,
      activeAccount: now.account,
      activeSeq: now.seq,
      aborted: input.signal.aborted,
      body: res.body,
    });
  } catch {
    const now = input.current();
    if (input.signal.aborted || now.seq !== input.requestedSeq || now.account !== input.requestedAccount) return { status: "idle" };
    return { status: "error", accountId: input.requestedAccount, message: HOLDER_NETWORK_ERROR };
  }
}
