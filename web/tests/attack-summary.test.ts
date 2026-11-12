import { describe, expect, it } from "vitest";
import { attackSummary } from "@/lib/attackSummary";
import { ATTACK_CASES } from "@/lib/liveChecks";

const ok = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { ok: true }]));
const refusalIds = ATTACK_CASES.filter((c) => c.kind === "attestation").map((c) => c.id);
const transferIds = ATTACK_CASES.filter((c) => c.kind === "tx").map((c) => c.id);

describe("attack summary counts come from the case data", () => {
  it("the data has six refusal cases and one allowed transfer", () => {
    expect(refusalIds.length).toBe(6);
    expect(transferIds.length).toBe(1);
  });

  it("six refusals and one allowed transfer, all confirmed", () => {
    const s = attackSummary(ATTACK_CASES, ok([...refusalIds, ...transferIds]));
    expect(s.text).toBe("6/6 refusals confirmed, 1/1 allowed transfer confirmed");
    expect(s.allPass).toBe(true);
  });

  it("a successful transfer is not counted as a refusal", () => {
    const s = attackSummary(ATTACK_CASES, ok(transferIds));
    expect(s.refusalPass).toBe(0);
    expect(s.refusalTotal).toBe(6);
    expect(s.transferPass).toBe(1);
    expect(s.text).toBe("0/6 refusals confirmed, 1/1 allowed transfer confirmed");
    expect(s.allPass).toBe(false);
  });

  it("one refusal that fails is reported as 5/6, not as a transfer", () => {
    const s = attackSummary(ATTACK_CASES, ok([...refusalIds.slice(1), ...transferIds]));
    expect(s.text).toBe("5/6 refusals confirmed, 1/1 allowed transfer confirmed");
    expect(s.allPass).toBe(false);
  });

  it("a transfer that is not confirmed does not inflate the refusal count", () => {
    const s = attackSummary(ATTACK_CASES, ok(refusalIds));
    expect(s.text).toBe("6/6 refusals confirmed, 0/1 allowed transfer confirmed");
    expect(s.allPass).toBe(false);
  });
});
