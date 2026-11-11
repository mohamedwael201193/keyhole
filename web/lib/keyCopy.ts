/**
 * /key copy about what a key is worth and what its tier means. No premium: tier, serial number, history and past swaps
 * are not priced in. A tier is described only as the trading limits the key may use.
 */
import { CAPS, type Finish } from "./traits";

export const NO_PREMIUM_NOTE = "Tier, serial number, history and past swaps are not priced in. None of them raises this key's price or value.";

const BORROW_NEAR: Record<Finish, string> = { Bronze: "0.05", Silver: "0.5", Gold: "5", Legendary: "5" };

/** What the tier lets the key do. Trading caps are the enclave's limits. The NEAR figure is the configured borrow maximum while lending is off. */
export function tierMeans(finish: Finish): string {
  const c = CAPS[finish];
  const finishNote = finish === "Legendary" ? " Legendary is a cosmetic Gold finish." : "";
  return `${finish}: this key may trade up to $${c.perTx} per trade, $${c.daily} per day and ${c.perMin} trades a minute. Borrow cap ${BORROW_NEAR[finish]} NEAR while lending is off.${finishNote} The tier sets only those limits.`;
}
