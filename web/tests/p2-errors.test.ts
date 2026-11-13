// P2: every error code the enclave can return has readable copy, and every code in the worker source is known here.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WORKER_ERROR_CODES, isKnownCode } from "@/lib/errors";
import { errorText } from "@/lib/i18n";
import en from "@/messages/en.json";

const E = (en as unknown as { errors: Record<string, string[]> }).errors;
const unknown = E.unknown;
/**
 * Every production Rust file in the worker: the scan used to read only lib.rs, main.rs and chainsig.rs, so a code
 * emitted anywhere else (native_blocked from native_send.rs) was invisible to the UI. Test files hold only mocks,
 * so they are skipped by name.
 */
const workerDir = fileURLToPath(new URL("../../tee/worker/src/", import.meta.url));
const workerFiles = readdirSync(workerDir).filter((f) => f.endsWith(".rs") && f !== "tests.rs" && !f.endsWith("_tests.rs")).sort();
const src = workerFiles.map((f) => readFileSync(path.join(workerDir, f), "utf8")).join("\n");
/**
 * Codes that only ever appear inside the #[cfg(test)] mock in tee/worker/src/native_send.rs (a fake RPC that
 * simulates a crash, a lost response and a not-yet-indexed transaction). They can never reach the UI, so they
 * are excluded by name instead of registered. Anything else the scan finds must be known to the UI.
 */
const TEST_ONLY_CODES = new Set(["crash", "lost", "pending"]);
const emitted = [...new Set([...src.matchAll(/err\(\s*"([a-z_]+)"/g), ...src.matchAll(/"([a-z_]+)",\s*"[^"]*"\.into\(\)\)/g), ...src.matchAll(/,\s*"([a-z_]+)",\s*format!/g)].map((m) => m[1]))].filter((c) => !TEST_ONLY_CODES.has(c)).sort();

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
