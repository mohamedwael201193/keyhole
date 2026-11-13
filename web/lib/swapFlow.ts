/**
 * The one primary action on /swap, as a pure function of what is known. Each step names one thing the holder does next,
 * in the order the trade needs it: connect, get a key, unlock, review the quote, sign, then the result.
 */
export type SwapInput = {
  signedIn: boolean;
  lookingUp: boolean;
  keyMiss: boolean;
  hasKey: boolean;
  sessionLive: boolean;
  amountOk: boolean;
  /** The amount is more than the holder's known balance of the pay token. */
  overBalance?: boolean;
  samePair: boolean;
  quoteFresh: boolean;
  /** The holder pressed "Review swap" for this exact trade. A fresh quote alone never shows the panel. */
  reviewed: boolean;
  quoting: boolean;
  swapping: boolean;
  swapDone: boolean;
};

export type SwapStep = "connect" | "checking" | "get_key" | "unlock" | "enter_amount" | "short" | "same_pair" | "quoting" | "review" | "confirm" | "pending" | "done";

export function swapStep(i: SwapInput): SwapStep {
  if (i.swapping) return "pending";
  if (i.swapDone) return "done";
  if (!i.signedIn) return "connect";
  if (i.lookingUp) return "checking";
  if (i.keyMiss || !i.hasKey) return "get_key";
  if (!i.sessionLive) return "unlock";
  if (i.overBalance) return "short";
  if (!i.amountOk) return "enter_amount";
  if (i.samePair) return "same_pair";
  if (i.quoting) return "quoting";
  if (!i.quoteFresh) return "review";
  if (!i.reviewed) return "review";
  return "confirm";
}

/** Button label and whether the button can be pressed, per step. Plain words, no jargon. */
export const SWAP_LABEL: Record<SwapStep, { label: string; enabled: boolean }> = {
  connect: { label: "Connect wallet", enabled: true },
  checking: { label: "Checking your key", enabled: false },
  get_key: { label: "Get your key", enabled: true },
  unlock: { label: "Unlock for 30 minutes", enabled: true },
  enter_amount: { label: "Enter an amount", enabled: false },
  /** The label gets the token symbol at the call site: "Not enough USDC". */
  short: { label: "Not enough", enabled: false },
  same_pair: { label: "Pick two different tokens", enabled: false },
  quoting: { label: "Getting your price", enabled: false },
  review: { label: "Review swap", enabled: true },
  confirm: { label: "Confirm and sign", enabled: true },
  pending: { label: "Swapping", enabled: false },
  done: { label: "Swap again", enabled: true },
};

/** Share of the user's balance a Max press fills in: the exact human amount, never more than the balance. Pure. */
export function maxAmount(raw: string | null | undefined, human: (raw: string) => string): string | null {
  if (!raw || !/^\d+$/.test(raw) || raw === "0") return null;
  return human(raw);
}
