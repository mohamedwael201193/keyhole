import { describe, it, expect } from "vitest";
import { fundsStep, FUND_STEPS, STATUS } from "../lib/oneclick";

describe("/settle: where the funds are at each step", () => {
  it.each([
    ["PENDING_DEPOSIT", 0, false], ["KNOWN_DEPOSIT_TX", 1, false], ["INCOMPLETE_DEPOSIT", 1, false],
    ["PROCESSING", 2, false], ["SUCCESS", 3, false], ["REFUNDED", 3, true], ["FAILED", 3, true],
  ] as const)("%s -> step %i (refund %s)", (s, step, refund) => expect(fundsStep(s)).toEqual({ step, refund }));
  it("every 1Click status has a step", () => { for (const s of Object.keys(STATUS)) expect(fundsStep(s)).not.toBeNull(); });
  it.each(["", "success", "toString", null, undefined])("unknown status %j has no step (no false claim)", (s) => expect(fundsStep(s as never)).toBeNull());
  it("steps run wallet -> deposit address -> intents.near -> recipient", () => expect(FUND_STEPS).toEqual(["Your wallet", "1Click deposit address", "NEAR Intents (intents.near)", "Recipient"]));
  it("the step text agrees with the status explanation", () => {
    expect(STATUS.PROCESSING.where).toContain("intents.near");
    expect(STATUS.REFUNDED.where.toLowerCase()).toContain("refund address");
  });
});
