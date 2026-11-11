/** Explicit consent to the candidate's three-hop NEAR USDC exit, not a bridge quote. */
export const EXACT_EXIT_MODE = "exact-near-v1";
export const EXACT_EXIT_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export function exactExitFields(amount: string, now = Date.now()) {
  if (!/^[1-9]\d*$/.test(amount) || BigInt(amount) > (1n << 128n) - 1n || !Number.isSafeInteger(now) || now < 0) throw Error("Positive exact USDC amount and valid clock required.");
  return { exit_mode: EXACT_EXIT_MODE, min_amount_out: amount, deadline_ms: now + 300_000 };
}
