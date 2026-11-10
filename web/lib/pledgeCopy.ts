import type { LoanState } from "./pledgeClient";

/** Plain labels for on-chain loan states. The raw enum stays available as a tooltip, never as the headline. */
const LOAN_STATE_LABEL: Record<LoanState, string> = {
  Freezing: "Locking account…",
  Offered: "Offer open",
  DisbursementPending: "Funds ready to claim",
  Active: "Loan active",
  UnlockPending: "Unlocking…",
};

export function loanStateLabel(state: string): string {
  return state in LOAN_STATE_LABEL ? LOAN_STATE_LABEL[state as LoanState] : state;
}

/** Terminal endings after the loan record is gone. Missing resolution stays unverified. */
export function terminalLabel(resolution: string | null | undefined): string {
  if (resolution === "canceled") return "Canceled · unlock confirmed";
  if (resolution === "repaid") return "Repaid · unlock confirmed";
  if (resolution === "default_claimed") return "Loan defaulted · unlock confirmed";
  return "Closed · history unverified";
}

export function accountAccess(input: { readable: boolean; pledged: boolean; unlocking: boolean; freezing?: boolean; epoch: string | null }): { label: string; detail: string } {
  if (!input.readable) return { label: "Unavailable", detail: "Chain read missing" };
  const epoch = input.epoch ?? "—";
  if (input.freezing) return { label: "Lock not confirmed", detail: `Lower-policy freeze still pending · owner epoch ${epoch}` };
  if (input.unlocking) return { label: "Unlocking", detail: `Custody thaw pending · owner epoch ${epoch}` };
  if (input.pledged) return { label: "Locked while pledged", detail: `Custody frozen · owner epoch ${epoch}` };
  return { label: "Available", detail: `Unpledged · owner epoch ${epoch}` };
}

/** Recovery actions follow the phase. Freezing retries a lock; only UnlockPending retries an unlock. */
export function policyAction(state: string, kind: "retry" | "check" | "unknown"): string {
  const locking = state === "Freezing";
  if (kind === "retry") return locking ? "Retry account lock" : "Retry account unlock";
  if (kind === "check") return locking ? "Check lock status" : "Check unlock status";
  return locking
    ? "Account lock not confirmed. Checking the original command. This command is still pending / UNKNOWN. No redispatch or timeout."
    : "Unlock not confirmed yet. This command is still pending / UNKNOWN. No redispatch or timeout unlock.";
}

export function disbursementCopy(viewerOwnsAccount: boolean, principal: string): { heading: string; text: string } {
  if (viewerOwnsAccount) {
    return {
      heading: "Claim the loan",
      text: `Claim ${principal} NEAR. Repayment starts only after delivery is confirmed. A failed or UNKNOWN cashout starts no debt.`,
    };
  }
  return {
    heading: "Waiting for the borrower",
    text: "Waiting for borrower to claim. No repayment clock yet. A failed or UNKNOWN cashout starts no debt.",
  };
}

/** Pending settlement is unknown. Only an available credit with no pending payout is still held. */
export function cashoutCopy(input: { pending: boolean; amount: string; nonce: string | null }): { title: string; detail: string; technical: string } {
  if (input.pending) {
    return {
      title: "Cashout pending; checking chain",
      detail: "Cashout confirmation pending. Funds may already have arrived; do not send again. Check the original transfer.",
      technical: `Cashout pending · nonce ${input.nonce ?? "—"}.`,
    };
  }
  return {
    title: `${input.amount} NEAR ready to withdraw`,
    detail: "Still held by the contract — not yet in your wallet.",
    technical: "",
  };
}

export function currentStep(state: string | null, viewerOwnsAccount: boolean): string {
  if (state === "Freezing") return "Now: locking the account";
  if (state === "Offered") return viewerOwnsAccount ? "Now: wait for funding" : "Now: verify and fund";
  if (state === "DisbursementPending") return viewerOwnsAccount ? "Now: claim the loan" : "Now: waiting for the borrower to claim";
  if (state === "Active") return viewerOwnsAccount ? "Now: repay" : "Now: wait or claim the account";
  if (state === "UnlockPending") return "Now: unlocking";
  return "Now: set the terms";
}

/** Chain time in Africa/Cairo, including seconds. due_ns 0 has not started. */
export function cairoTime(ns: string): string {
  if (ns === "0") return "Not started";
  const formatted = new Date(Number(BigInt(ns) / 1_000_000n)).toLocaleString("en-GB", {
    timeZone: "Africa/Cairo", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  return `${formatted} Cairo`;
}

export function unlockNotice(resolution: string | null, viewerOwnsAccount: boolean): { text: string; technical: string } {
  const technical = `${resolution ?? "Resolution committed"} · terminal lower-policy thaw still pending`;
  if (resolution === "default_claimed") {
    return {
      text: viewerOwnsAccount
        ? "Loan defaulted. The key is yours; final unlock is still finishing, so please wait before moving it."
        : "Transferred to the new holder. Your private access has ended.",
      technical,
    };
  }
  if (resolution === "repaid") {
    return {
      text: viewerOwnsAccount
        ? "Repaid. Final unlock is still finishing, so please wait before moving the key."
        : "Repaid. Unlocking is still finishing. The account is not yours to move.",
      technical,
    };
  }
  if (resolution === "canceled") {
    return {
      text: viewerOwnsAccount
        ? "Canceled. Final unlock is still finishing, so please wait before moving the key."
        : "Canceled. Unlocking is still finishing. The account is not yours to move.",
      technical,
    };
  }
  return {
    text: viewerOwnsAccount
      ? "Final unlock is still finishing, so please wait before moving the key."
      : "Unlocking is still finishing. The account is not yours to move.",
    technical,
  };
}

export type FloorKind = "proposed" | "offered" | "verified" | "funded";

export function floorCaption(kind: FloorKind): string {
  if (kind === "verified") return "Verified minimum · sealed signature verified";
  if (kind === "offered") return "Minimum to verify · not a current balance";
  if (kind === "funded") return "Loan minimum · not a current balance";
  return "Declared, not yet verified";
}

/** Exact whole seconds. Odd remainders stay in seconds; nothing is rounded into a cleaner hour. */
export function humanSeconds(sec: string): string {
  if (!/^\d+$/.test(sec)) return sec;
  const v = BigInt(sec);
  const h = v / 3600n;
  const m = (v % 3600n) / 60n;
  const s = v % 60n;
  const bit = (n: bigint, one: string, many: string) => `${n} ${n === 1n ? one : many}`;
  const parts: string[] = [];
  if (h > 0n) parts.push(bit(h, "hour", "hours"));
  if (m > 0n) parts.push(bit(m, "minute", "minutes"));
  if (s > 0n || parts.length === 0) parts.push(bit(s, "second", "seconds"));
  return parts.join(" ");
}

export function shortTokenId(token: string): string {
  if (token.length <= 18) return token;
  return `${token.slice(0, 10)}…${token.slice(-4)}`;
}

export type AssetBits = { token: string; amount: string; symbol?: string; decimals?: number };

export type AssetView = { name: string; amount: string; note: string; extra: string; tip: string; copyId: boolean };

/** `normalized` is the decimal rendering when decimals exist. Missing decimals are not shown as a token count. */
export function assetPresentation(asset: AssetBits, normalized: string | null): AssetView {
  if (asset.decimals === undefined || normalized === null) {
    return {
      name: "Other token",
      amount: "Value unknown",
      note: "Included in your collateral",
      extra: "Amount unavailable in token units",
      tip: `${asset.token} · ${asset.amount} base units · decimals unavailable`,
      copyId: true,
    };
  }
  const named = asset.symbol && asset.symbol.toUpperCase() !== "UNPRICED" ? asset.symbol : shortTokenId(asset.token);
  return {
    name: named,
    amount: normalized,
    note: "Price not quoted · included in your collateral",
    extra: "",
    tip: asset.token,
    copyId: false,
  };
}

export function actionHeading(input: { loanState: string | null; hasHistory: boolean; hasExit: boolean; ownsAccount?: boolean }): string {
  if (!input.loanState && !input.hasHistory && !input.hasExit) return "Set the terms";
  if (input.loanState === "DisbursementPending") return input.ownsAccount ? "Claim the loan" : "Waiting for the borrower";
  if (input.loanState === "Active") return "Repay or wait";
  if (input.loanState === "UnlockPending") return "Wait for unlock";
  if (input.loanState === "Offered") return "Offer is open";
  if (input.loanState === "Freezing") return "Locking the account";
  return "Settlement";
}

export const SWAP_COMPARE_SUMMARY = "Compare with a swap";
export const SWAP_COMPARE_BODY = "Swap comparison is not part of this release, so no savings estimate is shown.";
export const SWAP_COMPARE_COSTS = "The refundable bond, permanent storage, gas and provider costs stay separate. None is assumed to be zero.";
