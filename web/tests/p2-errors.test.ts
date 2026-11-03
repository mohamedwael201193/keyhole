// P2: every error code the enclave can return has readable copy, and every code in the worker source is known here.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { WORKER_ERROR_CODES, isKnownCode } from "@/lib/errors";
import { errorText } from "@/lib/i18n";
import en from "@/messages/en.json";

const E = (en as unknown as { errors: Record<string, string[]> }).errors;
const unknown = E.unknown;
const src = ["lib.rs", "main.rs", "chainsig.rs"].map((f) => readFileSync(new URL(`../../tee/worker/src/${f}`, import.meta.url), "utf8")).join("\n");
const emitted = [...new Set([...src.matchAll(/err\(\s*"([a-z_]+)"/g), ...src.matchAll(/"([a-z_]+)",\s*"[^"]*"\.into\(\)\)/g), ...src.matchAll(/,\s*"([a-z_]+)",\s*format!/g)].map((m) => m[1]))].sort();

describe("error copy", () => {
  it.each([...WORKER_ERROR_CODES])("%s has a message and a fix, neither generic", (c) => {
    const [msg, fix] = errorText(c);
    expect(msg.length).toBeGreaterThan(5); expect(fix.length).toBeGreaterThan(5);
    expect(msg).not.toBe(unknown?.[0]);
  });
  it("codes are unique", () => { expect(new Set(WORKER_ERROR_CODES).size).toBe(WORKER_ERROR_CODES.length); });
  it("an unknown code falls back to the generic copy", () => { expect(isKnownCode("definitely_not_a_code")).toBe(false); });
  it("found the worker's error codes in source", () => { expect(emitted.length).toBeGreaterThan(20); });
  it.each(emitted)("worker code %s is known to the UI", (c) => { expect(isKnownCode(c), c).toBe(true); });
});
