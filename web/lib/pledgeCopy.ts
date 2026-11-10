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

export function accountAccess(input: { readable: boolean; pledged: boolean; unlocking: boolean; epoch: string | null }): { label: string; detail: string } {
  if (!input.readable) return { label: "Unavailable", detail: "Chain read missing" };
  const epoch = input.epoch ?? "—";
  if (input.unlocking) return { label: "Unlocking", detail: `Custody thaw pending · owner epoch ${epoch}` };
  if (input.pledged) return { label: "Locked while pledged", detail: `Custody frozen · owner epoch ${epoch}` };
  return { label: "Available", detail: `Unpledged · owner epoch ${epoch}` };
}

export function unlockNotice(resolution: string | null, viewerOwnsAccount: boolean): { text: string; technical: string } {
  const technical = `${resolution ?? "Resolution committed"} · terminal lower-policy thaw still pending`;
  if (resolution === "default_claimed") {
    return {
      text: viewerOwnsAccount
        ? "Loan defaulted. The key is yours; final unlock is still finishing, so please wait before moving it."
        : "Loan defaulted. The key has moved to the new holder. Final unlock is still finishing, so please wait before moving it.",
      technical,
    };
  }
  if (resolution === "repaid") return { text: "Repaid. Final unlock is still finishing, so please wait before moving the key.", technical };
  if (resolution === "canceled") return { text: "Canceled. Final unlock is still finishing, so please wait before moving the key.", technical };
  return { text: "Final unlock is still finishing, so please wait before moving the key.", technical };
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

/** `normalized` is the decimal rendering when decimals exist. Missing decimals stay raw base units. */
export function assetPresentation(asset: AssetBits, normalized: string | null): { name: string; amount: string; note: string; tip: string } {
  if (asset.decimals === undefined || normalized === null) {
    return {
      name: "Unpriced token",
      amount: `${shortTokenId(asset.token)} · ${asset.amount} raw units`,
      note: "Amount not normalized · included in your collateral",
      tip: `${asset.token} · ${asset.amount} base units · decimals unavailable`,
    };
  }
  const named = asset.symbol && asset.symbol.toUpperCase() !== "UNPRICED" ? asset.symbol : shortTokenId(asset.token);
  return {
    name: named,
    amount: normalized,
    note: "Price not quoted · included in your collateral",
    tip: asset.token,
  };
}

export function actionHeading(input: { loanState: string | null; hasHistory: boolean; hasExit: boolean }): string {
  if (!input.loanState && !input.hasHistory && !input.hasExit) return "Set the terms";
  if (input.loanState === "DisbursementPending") return "Claim the loan";
  if (input.loanState === "Active") return "Repay or wait";
  if (input.loanState === "UnlockPending") return "Wait for unlock";
  if (input.loanState === "Offered") return "Offer is open";
  if (input.loanState === "Freezing") return "Locking the account";
  return "Settlement";
}

export const SWAP_COMPARE_SUMMARY = "Compare with a swap";
export const SWAP_COMPARE_BODY = "Swap comparison is not part of this release, so no savings estimate is shown.";
export const SWAP_COMPARE_COSTS = "The refundable bond, permanent storage, gas and provider costs stay separate. None is assumed to be zero.";
