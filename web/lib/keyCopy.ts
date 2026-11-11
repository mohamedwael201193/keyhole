/**
 * /key copy about what a key is worth and what its tier means. No premium: tier, serial number, history and past swaps
 * are not priced in. A tier is described only as the trading limits the key may use.
 */
import { CAPS, type Finish } from "./traits";

export const NO_PREMIUM_NOTE = "Tier, serial number, history and past swaps are not priced in. None of them raises this key's price or value.";

/** What the tier lets the key do. Caps are the enclave's limits (tee/worker limits_for_tier), in USD. */
export function tierMeans(finish: Finish): string {
  const c = CAPS[finish];
  return `${finish}: this key may trade up to $${c.perTx} per trade, $${c.daily} per day and ${c.perMin} trades a minute. The tier sets only those limits.`;
}
