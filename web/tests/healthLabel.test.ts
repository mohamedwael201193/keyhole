import { describe, expect, it } from "vitest";
import { healthLabel } from "@/lib/healthLabel";
describe("healthLabel (health strip)", () => {
  const at = Date.UTC(2026, 10, 3, 19, 30);
  it("online only after an approved probe", () => expect(healthLabel({ at, online: true, reason: null, mode: "active", fresh: true })).toEqual({ state: "ok", text: "Enclave online: an approved info probe answered at 19:30 UTC" }));
  it("passive health does not claim the enclave is online", () => { const l = healthLabel({ at, online: null, reason: "not_probed", mode: "passive", fresh: false }); expect(l.state).toBe("wait"); expect(l.text).toMatch(/not probed/); expect(l.text).toMatch(/does not spend/); });
  it("unfunded is offline with the reason, and says proofs still verify", () => { const l = healthLabel({ at, online: false, reason: "service_unfunded" }); expect(l.state).toBe("down"); expect(l.text).toMatch(/payment balance is empty/); expect(l.text).toMatch(/still verifies/); });
  it("network and gateway reasons differ", () => { expect(healthLabel({ at, online: false, reason: "network" }).text).toMatch(/did not answer/); expect(healthLabel({ at, online: false, reason: "gateway" }).text).toMatch(/not configured/); });
  it("pending and unreachable", () => { expect(healthLabel(null).state).toBe("wait"); expect(healthLabel("error").state).toBe("down"); });
});
