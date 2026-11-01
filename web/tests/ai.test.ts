import { describe, expect, it } from "vitest";
import fx from "./fixtures/ai_reply.json";
import { allPass, answerOf, checkReply, reportData, type AiReply } from "@/lib/ai";

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
