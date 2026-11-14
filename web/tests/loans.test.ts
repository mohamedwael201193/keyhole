import { describe, expect, it } from "vitest";
import {
  LOAN_A,
  LOAN_B,
  LOAN_COSTS,
  LOAN_TXS,
  RESERVES,
  VAULT_READS,
  formatLoanTime,
  shortAccount,
  shortHash,
} from "@/lib/loans";

const BASE58_43_44 = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

describe("loans evidence data", () => {
  it("has 12 transactions: 7 for Loan A, 5 for Loan B", () => {
    expect(LOAN_TXS).toHaveLength(12);
    expect(LOAN_A.txs).toHaveLength(7);
    expect(LOAN_B.txs).toHaveLength(5);
  });

  it("every hash is a unique 43-44 char base58 NEAR tx hash", () => {
    const hashes = LOAN_TXS.map((t) => t.hash);
    expect(new Set(hashes).size).toBe(12);
    for (const h of hashes) expect(h).toMatch(BASE58_43_44);
  });

  it("blocks rise inside each loan; Loan A carries exactly one FAILED tx, Loan B none", () => {
    for (const loan of [LOAN_A, LOAN_B]) {
      const blocks = loan.txs.map((t) => t.block);
      expect(blocks).toEqual([...blocks].sort((a, b) => a - b));
    }
    expect(LOAN_A.txs.filter((t) => t.status === "FAILED")).toHaveLength(1);
    expect(LOAN_A.txs.find((t) => t.status === "FAILED")?.label).toContain("failed");
    expect(LOAN_B.txs.every((t) => t.status === "SUCCESS")).toBe(true);
  });

  it("every node has a label, a plain explanation, and a UTC timestamp", () => {
    for (const t of LOAN_TXS) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.plain.length).toBeGreaterThan(10);
      expect(t.timeUtc).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
    expect(LOAN_A.outcome).toBe("REPAID");
    expect(LOAN_B.outcome).toBe("DEFAULTED");
    expect(LOAN_A.repaidNear).toBe("0.0101");
    expect(LOAN_B.repaidNear).toBeNull();
  });

  it("formats loan times and short ids", () => {
    expect(formatLoanTime("2026-11-14 10:45:29")).toBe("14 Nov 2026, 10:45 UTC");
    expect(shortHash("BSkutP8G6ZWtWahYisXai9k5V579otDKYRsYwWSkjXQx")).toBe("BSkutP…jXQx");
    expect(shortAccount("0705fdc1581a35351453bd4625f22d0c41b2b9edc3e7bed860586623c6778228")).toBe("0705fdc1…");
  });

  it("costs table carries the measured §9 figures", () => {
    expect(LOAN_COSTS).toHaveLength(4);
    expect(LOAN_COSTS[0]).toEqual({ cost: "Mint (Bronze)", amount: "0.1 NEAR" });
    expect(LOAN_COSTS[1].amount).toContain("0.009 NEAR");
    expect(LOAN_COSTS[2].amount).toContain("0.0001 NEAR");
    expect(LOAN_COSTS[3].amount).toContain("0.0032 NEAR");
  });

  it("value history is two historical reads with a 0.1 USDC withdrawal delta", () => {
    expect(VAULT_READS).toHaveLength(2);
    expect(VAULT_READS[0].valueUsdc).toBe("0.213652");
    expect(VAULT_READS[1].valueUsdc).toBe("0.113652");
    const delta = Number(VAULT_READS[0].valueUsdc) - Number(VAULT_READS[1].valueUsdc);
    expect(delta).toBeCloseTo(0.1, 6);
  });

  it("reserves are labelled TEE-internal, never a live balance", () => {
    expect(RESERVES.custodyCreditRaw).toBe("899,818");
    expect(RESERVES.custodyCreditUsdc).toBe("0.899818");
    expect(RESERVES.walletId).toBe("e6184650-8e9b-482d-8cc3-983530f52cf0");
  });
});
