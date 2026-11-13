/**
 * Pure rules for the swap screen: the live progress steps and the outcome words. No React here, so they are unit-tested.
 * The stages are the real ones useSigned reports for a signed swap (lib/useSigned.ts): wallet, enclave, settling.
 */

/** The stage a signed swap is in, exactly as useSigned reports it. "idle" is "not running". */
export type SwapStage = "idle" | "wallet" | "enclave" | "settling";

export type SwapStepId = "price" | "wallet" | "enclave" | "settling";
export type SwapStepState = "pending" | "active" | "done" | "error";
export type SwapStep = { id: SwapStepId; label: string; detail?: string; state: SwapStepState };

/** The order the signed stages run in. "settling" only starts after the enclave has been working for six seconds (lib/useSigned.ts). */
const RANK: Record<SwapStage, number> = { idle: 0, wallet: 1, enclave: 2, settling: 3 };

const COPY: Record<Exclude<SwapStage, "idle">, { label: string; detail: string }> = {
  wallet: { label: "Confirm in your wallet", detail: "Your wallet signs the swap request once." },
  enclave: { label: "Enclave runs the swap", detail: "Checked and signed inside your key's vault." },
  settling: { label: "Settling on NEAR Intents", detail: "Solvers fill the swap. The result shows when it lands." },
};

/**
 * The steps for a swap. `price` is always done: a swap only starts with a fresh quote. The wallet step is there only when
 * the swap was signed by a wallet (not by a live session). While running, the current stage is active and the earlier ones
 * are done. When it failed at a stage, that step is an error, the earlier ones are done and the later ones never ran.
 */
export function swapSteps(i: { stage: SwapStage; viaWallet: boolean; failedAt?: SwapStage | null; minOut?: string | null }): SwapStep[] {
  const ids: Exclude<SwapStage, "idle">[] = i.viaWallet ? ["wallet", "enclave", "settling"] : ["enclave", "settling"];
  // A failure with no known stage, or at the wallet step of a session swap, is reported at the enclave step.
  const failed = i.failedAt ? (ids.includes(i.failedAt as Exclude<SwapStage, "idle">) ? i.failedAt : "enclave") : null;
  const cur = failed ? RANK[failed] : RANK[i.stage];
  const steps: SwapStep[] = [{ id: "price", label: "Price locked", detail: i.minOut ? `Minimum received ${i.minOut}` : undefined, state: "done" }];
  for (const id of ids) {
    const r = RANK[id];
    let state: SwapStepState;
    if (failed) state = id === failed ? "error" : r < cur ? "done" : "pending";
    else state = r < cur ? "done" : r === cur ? "active" : "pending";
    steps.push({ id, ...COPY[id], state });
  }
  return steps;
}

export type SwapOutcomeTone = "success" | "warn" | "error" | "neutral";
export type SwapOutcome = { tone: SwapOutcomeTone; chip: string; headline: string; where: string; icon: "check" | "swap" | "x" | "info" };

/**
 * What a swap's status word means, in plain words. The words are the ones the enclave returns (lowercase: success, pending,
 * processing, submitted, refunded, failed, error). An unknown word keeps its own text in a neutral chip; no status at all is said so.
 */
export function swapOutcome(status: string | null | undefined): SwapOutcome {
  const s = (status ?? "").trim().toLowerCase();
  if (!s) return { tone: "neutral", chip: "Status not shown", headline: "Swap submitted", where: "The enclave did not return a status for this swap.", icon: "info" };
  if (s === "success") return { tone: "success", chip: "Settled", headline: "Swap settled", where: "Funds arrived in your key's vault.", icon: "check" };
  if (s === "pending" || s === "processing" || s === "submitted") {
    return { tone: "warn", chip: "In progress", headline: "Swap on its way", where: "Solvers are still filling the swap. Read your history later to see the final status.", icon: "swap" };
  }
  if (s === "unknown") {
    return { tone: "warn", chip: "No final answer", headline: "Swap not confirmed", where: "Nothing was lost. Confirm the earlier operation before swapping again.", icon: "info" };
  }
  if (s === "refunded") return { tone: "warn", chip: "Refunded", headline: "Swap refunded", where: "The swap did not happen; the deposit went back to the refund address.", icon: "swap" };
  if (s === "failed" || s === "error") {
    return { tone: "error", chip: "Failed", headline: "Swap failed", where: "1Click refunds the deposit to the refund address. Check the refund before you try again.", icon: "x" };
  }
  return { tone: "neutral", chip: status ?? "Unknown", headline: "Swap submitted", where: "The enclave returned a status this page does not know yet.", icon: "info" };
}
