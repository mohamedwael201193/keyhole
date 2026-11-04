import { describe, expect, it } from "vitest";
import fx from "./fixtures/ai_reply.json";
import { allPass, answerOf, askVerdict, checkReply, reportData, type AiChecks, type AiReply } from "@/lib/ai";

const r = fx as unknown as AiReply;
const nonce = r.attestation.nonce;

describe("private assistant evidence", () => {
  it("a real NEAR AI reply passes every browser check", async () => {
    const c = await checkReply(r, nonce);
    expect(c).toMatchObject({ nonceInQuote: true, signerInQuote: true, nonceEcho: true, requestHash: true, responseHash: true, modelMatch: true, signatureValid: true });
    expect(allPass(c)).toBe(true);
    expect(answerOf(r)).toMatch(/10-minute/);
  });
  it("a different nonce fails freshness", async () => {
    const c = await checkReply(r, "0".repeat(64));
    expect(c.nonceInQuote).toBe(false);
    expect(allPass(c)).toBe(false);
  });
  it("an edited answer fails the response hash", async () => {
    const c = await checkReply({ ...r, response_body: r.response_body.replace("10-minute", "1-minute") }, nonce);
    expect(c.responseHash).toBe(false);
  });
  it("report_data is read from the quote", () => {
    expect(reportData(r.attestation.intel_quote)?.nonce).toBe(nonce);
  });
});

describe("askVerdict (/ask badge gate)", () => {
  const ok = { nonceInQuote: true, signerInQuote: true, nonceEcho: true, requestHash: true, responseHash: true, modelMatch: true, signatureValid: true, recovered: "0x1" } as unknown as AiChecks;
  it("a GPU nonce mismatch makes the verdict false even when bindings and DCAP pass", () => expect(askVerdict(ok, true, "fail")).toBe(false));
  it("passes with GPU pass or no GPU payload", () => { expect(askVerdict(ok, true, "pass")).toBe(true); expect(askVerdict(ok, true, "n/a")).toBe(true); });
  it("fails without DCAP or checks", () => { expect(askVerdict(ok, false, "pass")).toBe(false); expect(askVerdict(null, true, "pass")).toBe(false); });
});
