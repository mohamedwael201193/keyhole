import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IDENTITY } from "@/lib/identity.gen";

const CUR = IDENTITY.worker.wasm_sha256.slice(0, 8);
const STEP4_IDS = [
  "2a52742a-2b4a-432d-b087-888ea52f03ce",
  "baccd727-cdca-4b3e-ae93-999fd581444a",
  "ece5d109-6b98-442f-b682-96af0a23f2e7",
  "3e996273-e4a0-4c26-aa54-6775fba29236",
  "15f93f58-2568-4064-9581-db04c8b2a1aa",
  "8485f8d4-c4e1-4ab5-ab9c-a19a0d9d21f7",
];
const KNOWN_STEP4_WASM = "a985fd87"; // prefix of executed_wasm for these calls

describe("judge Step 4 build labels", () => {
  const src = readFileSync(new URL("../app/verify/path/page.tsx", import.meta.url), "utf8");
  const step4 = src.slice(src.indexOf("testid=\"judge-step-4\""), src.indexOf("testid=\"judge-step-5\""));

  it("does not hardcode current:true on STEP4_NOW calls", () => {
    expect(src).not.toMatch(/2a52742a[\s\S]{0,120}current:\s*true/);
    for (const id of STEP4_IDS) {
      const line = src.split("\n").find((l) => l.includes(id));
      expect(line, id).toBeTruthy();
      expect(line!, id).not.toMatch(/current:\s*true/);
      expect(line!, id).toMatch(/build:\s*STEP4_BUILD/);
    }
  });

  it("Step 4 prose names STEP4_BUILD, not Current build badge for those calls", () => {
    expect(step4).toContain("STEP4_BUILD");
    expect(step4).toContain("previous");
    // The Current build badge is only rendered when r.current — STEP4 rows must not set it.
    expect(src).toMatch(/const STEP4_BUILD = "a985fd87"/);
  });

  it("STEP4_BUILD is not the current identity wasm prefix", () => {
    expect(KNOWN_STEP4_WASM).not.toBe(CUR);
    expect(src).toContain(`const STEP4_BUILD = "${KNOWN_STEP4_WASM}"`);
  });
});
