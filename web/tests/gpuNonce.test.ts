import { describe, it, expect } from "vitest";
import fx from "./fixtures/nearai_gpu.json";
import { gpuNonces, gpuNonceCheck, reportData } from "../lib/ai";

// Real NEAR AI attestation captured 2026-11-03 for a nonce this test suite made (8 Hopper GPUs).
const g = gpuNonces(fx.nvidia_payload)!;
describe("fresh nonce in TDX and NVIDIA evidence", () => {
  it("the TDX quote's report_data ends with our nonce", () => expect(reportData(fx.intel_quote)!.nonce).toBe(fx.nonce));
  it("NEAR AI echoes the same request nonce", () => expect(fx.request_nonce).toBe(fx.nonce));
  it("NVIDIA eat_nonce is our nonce", () => expect(g.eat_nonce).toBe(fx.nonce));
  it("every GPU's SPDM GET_MEASUREMENTS request carries our nonce", () => {
    expect(g.evidence_nonces).toHaveLength(8);
    for (const n of g.evidence_nonces) expect(n).toBe(fx.nonce);
    expect(g.arch).toBe("HOPPER");
  });
  it("passes for the right nonce and fails for any other", () => {
    expect(gpuNonceCheck(g, fx.nonce)).toBe("pass");
    expect(gpuNonceCheck(g, "00".repeat(32))).toBe("fail");
  });
  it("one GPU report with a different nonce fails the whole check", () => {
    const bad = { ...g, evidence_nonces: [...g.evidence_nonces.slice(1), "ab".repeat(32)] };
    expect(gpuNonceCheck(bad, fx.nonce)).toBe("fail");
  });
  it("an eat_nonce that does not match fails even if GPU reports match", () => expect(gpuNonceCheck({ ...g, eat_nonce: "cd".repeat(32) }, fx.nonce)).toBe("fail"));
  it("empty evidence list fails, no payload is n/a", () => {
    expect(gpuNonceCheck({ ...g, evidence_nonces: [] }, fx.nonce)).toBe("fail");
    expect(gpuNonceCheck(null, fx.nonce)).toBe("n/a");
  });
  it.each([undefined, "", "not json", "{}", '{"nonce":"x"}', '{"nonce":"x","evidence_list":[]}'])("malformed payload %j gives no nonces", (p) => expect(gpuNonces(p)).toBeNull());
  it("a report that is not an SPDM measurement request yields no nonce", () => {
    const r = gpuNonces(JSON.stringify({ nonce: fx.nonce, arch: "HOPPER", evidence_list: [{ evidence: btoa("\u0011\u0000xx" + "a".repeat(40)) }] }))!;
    expect(gpuNonceCheck(r, fx.nonce)).toBe("fail");
  });
  it("a different (stale) nonce in the quote is detected", () => expect(reportData(fx.intel_quote)!.nonce).not.toBe("00".repeat(32)));
});
