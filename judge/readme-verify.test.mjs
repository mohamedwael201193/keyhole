import assert from "node:assert/strict";
import test from "node:test";
import { checkLog } from "../tee/worker/verify-log.mjs";
import { mutationsFail, recordedBindingHolds, recordedLogMutationsFail, signedFixture } from "./readme-verify.mjs";

test("a signed log verifies, and an owner or detail mutation does not", () => {
  const doc = signedFixture();
  assert.equal(checkLog(doc).ok, true);
  assert.equal(mutationsFail(doc), true);
  assert.equal(recordedBindingHolds(), true);
  assert.equal(recordedLogMutationsFail(), true);
});
