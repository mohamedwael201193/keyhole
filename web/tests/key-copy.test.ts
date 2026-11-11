import { describe, expect, it } from "vitest";
import { NO_PREMIUM_NOTE, tierMeans } from "@/lib/keyCopy";
import { CAPS, FINISHES } from "@/lib/traits";

describe("/key tier copy", () => {
  it.each(FINISHES)("%s says only what the key may do, with the enclave's caps", (f) => {
    const t = tierMeans(f);
    expect(t).toContain(`$${CAPS[f].perTx} per trade`);
    expect(t).toContain(`$${CAPS[f].daily} per day`);
    expect(t).toContain("The tier sets only those limits.");
    expect(t).toContain("NEAR");
    if (f === "Legendary") expect(t).toContain("cosmetic Gold finish");
  });
  it.each(FINISHES)("%s never claims a price, rarity or value", (f) => {
    expect(tierMeans(f)).not.toMatch(/worth|premium|rare|rarity|value|price|collect|scarc/i);
  });
  it("the no-premium note names tier, serial, history and past swaps", () => {
    expect(NO_PREMIUM_NOTE).toContain("Tier, serial number, history and past swaps are not priced in");
    expect(NO_PREMIUM_NOTE).toContain("None of them raises this key's price or value");
  });
});
