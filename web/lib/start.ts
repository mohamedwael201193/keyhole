/** /start wizard: which step a visitor is on, derived from facts (so it resumes by itself). */
export const START_STEPS = ["connect", "mint", "unlock", "limits", "fund", "done"] as const;
export type StartStep = (typeof START_STEPS)[number];
export type StartFacts = { connected: boolean; holder: boolean | null; unlocked: boolean; limitsDone: boolean; funded: boolean };

export function startStep(f: StartFacts): StartStep {
  if (!f.connected) return "connect";
  if (f.holder === false) return "mint";
  if (!f.unlocked) return "unlock";
  if (!f.limitsDone) return "limits";
  if (!f.funded) return "fund";
  return "done";
}
/** Wallet popups a first session costs: connect, mint, unlock (holder: connect, unlock). */
export const popupBudget = (holder: boolean) => (holder ? 2 : 3);
/** One-click safe limits: $1 per trade, $5 a day (sent through the session; lowering needs no popup). */
export const SAFE_LIMITS = { per_tx_usd_micro: 1_000_000, daily_usd_micro: 5_000_000 };
export const LIMITS_FLAG = "kh_start_limits";
