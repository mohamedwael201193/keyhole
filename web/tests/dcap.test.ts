import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { b64, verifyQuote } from "@/lib/dcap";
const att = JSON.parse(readFileSync(`${__dirname}/fixtures/att_f4768da8.json`, "utf8"));
const q = () => b64(att.tdx_quote);
const AT = Date.UTC(2026, 10, 1);
describe("dcap", () => {
  it("verifies a real mainnet TDX quote end to end", () => {
    const r = verifyQuote(q(), { now: AT });
    expect(r.checks.filter((c) => !c.pass)).toEqual([]);
    expect(r.checks.length).toBeGreaterThanOrEqual(18);
  });
  it("fails the quote signature when the TD report is changed", () => {
    const b = q(); b[48 + 520] ^= 1;
    const r = verifyQuote(b, { now: AT });
    expect(r.checks.find((c) => c.id === "quoteSig")!.pass).toBe(false);
  });
  it("fails the QE binding when the attestation key is changed", () => {
    const b = q(); b[700] ^= 1;
    expect(verifyQuote(b, { now: AT }).checks.find((c) => c.id === "qeBind")!.pass).toBe(false);
  });
  it("fails the PCK signature when the QE report is changed", () => {
    const b = q(); b[770 + 10] ^= 1;
    expect(verifyQuote(b, { now: AT }).checks.find((c) => c.id === "qeSig")!.pass).toBe(false);
  });
  it("rejects certificates outside their validity window", () => {
    expect(verifyQuote(q(), { now: Date.UTC(2060, 0, 1) }).checks.find((c) => c.id === "dates")!.pass).toBe(false);
  });
  it("checks expected report_data", () => {
    const r = verifyQuote(q(), { now: AT });
    expect(verifyQuote(q(), { now: AT, expectReportData: r.reportData }).checks.find((c) => c.id === "rd")!.pass).toBe(true);
    expect(verifyQuote(q(), { now: AT, expectReportData: "00".repeat(32) }).checks.find((c) => c.id === "rd")!.pass).toBe(false);
  });
});
