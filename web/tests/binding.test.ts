import { describe, expect, it } from "vitest";
import att from "./fixtures/att_e805f050.json";
import ev from "../public/evidence/e805f050-d416-4a04-9b12-270adbe02068.json";
import { bindingCheck, buildIndex, canonical, outputCheck, type Attestation } from "@/lib/verify";

const a = att as unknown as Attestation;

describe("attestation binding", () => {
  it("TDX report_data equals sha256 of the attested call fields", async () => {
    const b = await bindingCheck(a);
    expect(b?.match).toBe(true);
    expect(b?.inQuote).toMatch(/^[0-9a-f]{64}$/);
  });
  it("a changed output_hash breaks the binding", async () => {
    const b = await bindingCheck({ ...a, output_hash: "0".repeat(64) });
    expect(b?.match).toBe(false);
  });
  it("the published output hashes to the attested output_hash", async () => {
    const o = await outputCheck(a, ev.output, "evidence");
    expect(o.match).toBe(true);
    expect(o.verdict).toBe("refused · not_owner");
    const bad = await outputCheck(a, { ...ev.output, ok: true }, "pasted");
    expect(bad.match).toBe(false);
  });
  it("canonical JSON sorts keys and has no spaces", () => {
    expect(canonical({ b: 1, a: [true, null, "x"] })).toBe('{"a":[true,null,"x"],"b":1}');
  });
  it("knows superseded builds", () => {
    expect(buildIndex(a.executed_wasm_sha256)).toBe(7);
    expect(buildIndex("f".repeat(64))).toBe(-1);
  });
});
