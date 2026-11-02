import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyQuote } from "@/lib/dcap";

// Real NEAR AI Cloud attestation quotes (Intel TDX), fetched 2026-11-02 with a fresh nonce each.
const fx = JSON.parse(readFileSync(`${__dirname}/fixtures/nearai_quotes.json`, "utf8")) as Record<string, { signing_address: string; request_nonce: string; intel_quote: string }>;
const ai = JSON.parse(readFileSync(`${__dirname}/fixtures/ai_reply.json`, "utf8")).attestation as { signing_address: string; nonce: string; intel_quote: string };
const all = { ...fx, ask_reply: { ...ai, request_nonce: ai.nonce } };
const bytes = (h: string) => Uint8Array.from(h.replace(/^0x/, "").match(/../g)!, (b) => parseInt(b, 16));
const signer = (a: string) => a.toLowerCase().replace(/^0x/, "").padEnd(64, "0");
const NOW = Date.parse("2026-11-02T12:00:00Z");
const flip = (q: Uint8Array, at: number) => { const c = q.slice(); c[at] ^= 1; return c; };

describe.each(Object.entries(all))("NEAR AI quote %s", (_name, a) => {
  const q = bytes(a.intel_quote);
  it("passes all 19 DCAP checks with report_data bound to the signing address", () => {
    const r = verifyQuote(q, { expectReportData: signer(a.signing_address), now: NOW });
    expect(r.checks.filter((c) => !c.pass)).toEqual([]);
    expect(r.checks).toHaveLength(19);
  });
  it("carries the request nonce in report_data[32:64]", () => {
    expect(verifyQuote(q, { now: NOW }).reportData.slice(64)).toBe(a.request_nonce);
  });
  it("fails report_data binding for a different signing address", () => {
    const r = verifyQuote(q, { expectReportData: "11".repeat(20).padEnd(64, "0"), now: NOW });
    expect(r.checks.find((c) => c.id === "rd")?.pass).toBe(false);
  });
  it("fails when one bit of the TD report changes", () => {
    expect(verifyQuote(flip(q, 48 + 520), { now: NOW }).ok).toBe(false);
  });
  it("fails when the attestation-key signature is altered", () => {
    expect(verifyQuote(flip(q, 48 + 584 + 4 + 10), { now: NOW }).ok).toBe(false);
  });
  it("fails after the PCK certificate expires", () => {
    expect(verifyQuote(q, { now: Date.parse("2040-01-01T00:00:00Z") }).checks.find((c) => c.id === "dates")?.pass).toBe(false);
  });
});
