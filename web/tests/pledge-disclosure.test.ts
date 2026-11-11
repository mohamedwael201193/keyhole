import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FLOOR_NOTE, FORFEIT_ACK, FORFEIT_LINE, borrowerNumbers, nearText, swapComparisonLine } from "@/lib/pledgeDisclosure";

const NEAR = 10n ** 24n;
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("borrower screen wording", () => {
  it("the first line says the lender receives the whole key and vault on default", () => {
    expect(FORFEIT_LINE).toBe("If you default, the lender receives the whole key and everything in its vault.");
  });
  it("the checkbox names the forfeiture", () => {
    expect(FORFEIT_ACK).toBe("I understand the whole account is forfeited on default");
  });
  it("total cost is repayment minus principal, exact", () => {
    expect(borrowerNumbers((10n * NEAR).toString(), (10n * NEAR + 100000000000000000000n).toString())).toEqual({ borrow: "10", repay: "10.0001", cost: "0.0001" });
    expect(borrowerNumbers((10n * NEAR).toString(), (10n * NEAR).toString())).toMatchObject({ cost: "0" });
  });
  it("refuses zero principal and repayment below principal (no numbers shown)", () => {
    expect(() => borrowerNumbers("0", "1")).toThrow();
    expect(() => borrowerNumbers((2n * NEAR).toString(), NEAR.toString())).toThrow();
  });
  it("exact decimals keep every digit", () => {
    expect(nearText(1n)).toBe("0.000000000000000000000001");
    expect(nearText(NEAR * 3n / 2n)).toBe("1.5");
  });
  it("the swap comparison is one honest line, and says so when no quote exists", () => {
    const line = swapComparisonLine((10n * NEAR).toString(), (10n * NEAR + 1n).toString());
    expect(line).toMatch(/^Selling part of the vault via swap instead: /);
    expect(line).toContain("no same-ledger swap quote is available");
    expect(line.split("\n")).toHaveLength(1);
  });
});

describe("lender floor wording", () => {
  it("states the four limits and the single fixed floor", () => {
    expect(FLOOR_NOTE).toContain("Raw-token minimum at freeze");
    expect(FLOOR_NOTE).toContain("not a USD value");
    expect(FLOOR_NOTE).toContain("not LTV");
    expect(FLOOR_NOTE).toContain("not solvency");
    expect(FLOOR_NOTE).toContain("not a ZK proof");
    expect(FLOOR_NOTE).toContain("One floor, fixed in the loan terms");
  });
});

describe("the sign button needs the forfeiture checkbox", () => {
  it("openReady includes the forfeiture acknowledgement", () => {
    const live = src("../app/pledge/LivePledge.tsx");
    expect(live).toMatch(/const openReady=.*&&ack&&forfeitAck;/);
  });
  it("the borrower screen sits before the sign button in the form", () => {
    const live = src("../app/pledge/LivePledge.tsx");
    const screen = live.indexOf("<BorrowerScreen");
    const button = live.indexOf(">Pledge this account</button>");
    expect(screen).toBeGreaterThan(0);
    expect(button).toBeGreaterThan(screen);
  });
  it("the screen itself has no Details toggle", () => {
    expect(src("../app/pledge/BorrowerScreen.tsx")).not.toMatch(/<details|<summary/);
  });
});
