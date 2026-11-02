import { describe, expect, it } from "vitest";
import { dryBody, isAddr, OC_ASSETS, STATUS, statusOf, toUnits } from "@/lib/oneclick";
import { SETTLEMENTS } from "@/lib/settlements";
const [U, W, SU] = [OC_ASSETS[0].id, OC_ASSETS[1].id, OC_ASSETS[2].id];
describe("1Click dry-run", () => {
  it("always builds a dry quote", () => expect(dryBody({ origin: SU, dest: U, amount: "50000" })!.dry).toBe(true));
  it("uses chain-appropriate placeholder addresses", () => { const b = dryBody({ origin: SU, dest: U, amount: "50000" })!; expect(b.refundTo).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/); expect(b.recipient).toBe("keyhole-devmo.near"); });
  it("rejects unknown assets, same asset and bad amounts", () => {
    expect(dryBody({ origin: "nep141:evil", dest: U, amount: "1" })).toBeNull();
    expect(dryBody({ origin: U, dest: U, amount: "1" })).toBeNull();
    expect(dryBody({ origin: U, dest: W, amount: "-1" })).toBeNull();
    expect(dryBody({ origin: U, dest: W, amount: "1e9" })).toBeNull();
  });
  it("converts decimals without floats", () => { expect(toUnits("0.05", 6)).toBe("50000"); expect(toUnits("1", 24)).toBe("1" + "0".repeat(24)); expect(toUnits("0", 6)).toBeNull(); expect(toUnits("1234567", 6)).toBeNull(); });
});
describe("1Click status", () => {
  it("maps REFUNDED and FAILED to visible, non-green states", () => { expect(STATUS.REFUNDED.tone).toBe("warn"); expect(STATUS.FAILED.tone).toBe("bad"); });
  it("every status says where the funds are", () => { for (const v of Object.values(STATUS)) expect(v.where.length).toBeGreaterThan(20); });
  it("unknown statuses are not shown as success", () => expect(statusOf("WEIRD").tone).toBe("wait"));
  it("accepts NEAR, EVM and Solana deposit addresses only", () => { expect(isAddr("a".repeat(64))).toBe(true); expect(isAddr("0x" + "a".repeat(40))).toBe(true); expect(isAddr("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")).toBe(true); expect(isAddr("../../etc")).toBe(false); });
  it("listed settlements have real-looking deposit addresses and txs", () => { for (const s of SETTLEMENTS) { expect(isAddr(s.depositAddress)).toBe(true); expect(s.depositTx).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$|^0x[0-9a-f]{64}$/); if (s.depositTxUrl) expect(s.depositTxUrl).toMatch(/^https:\/\/basescan\.org\/tx\/0x[0-9a-f]{64}$/); } });
});
