/** Default claims mode must not request the health route that used to spend compute. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const claims = JSON.parse(readFileSync(new URL("../docs/claims.json", import.meta.url), "utf8"));
const verifier = readFileSync(new URL("./verify-claims.mjs", import.meta.url), "utf8");

test("no claim URL hits /api/health or OutLayer /call", () => {
  for (const claim of claims.claims) {
    for (const key of ["url", "evidence"]) {
      const value = key === "url" ? claim.check?.url : claim.evidence;
      if (typeof value !== "string" || !value.startsWith("http")) continue;
      assert.equal(value.includes("/api/health"), false, claim.id);
      assert.equal(value.includes("/call/"), false, claim.id);
    }
  }
});

test("the claims runner does not call OutLayer /call", () => {
  assert.equal(verifier.includes("/call/"), false);
  assert.match(verifier, /does not call OutLayer \/call/);
});
