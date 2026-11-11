import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
test("CLI verifier and rebuild default derive the same exact history/current call as browser", () => {
  const verifier=readFileSync(new URL("../verify.sh",import.meta.url),"utf8"),
    rebuild=readFileSync(new URL("./3-verify.sh",import.meta.url),"utf8"),
    id=JSON.parse(readFileSync(new URL("../identity.json",import.meta.url)));
  assert.ok(verifier.includes(".worker.previous_wasm_sha256"));
  assert.ok(verifier.includes(".worker.historical_wasm_sha256"));
  assert.ok(verifier.includes('else bad "executed $H != published build $PUB"'));
  assert.ok(rebuild.includes(".worker.info_call"));
  assert.ok(!rebuild.includes("dc3668db-674f-4865-a2ce-272f70c41b0d"));
  assert.equal(id.worker.previous_wasm_sha256,"d337e822544d31da644728ba794f444f7f3ef6c54a6ee7442ab22d07e049ae41");
  assert.ok(!id.worker.historical_wasm_sha256.includes("0".repeat(64)));
});
