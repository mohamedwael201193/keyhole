import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const id = JSON.parse(readFileSync(new URL("../identity.json", import.meta.url))),
  claims = JSON.parse(readFileSync(new URL("../docs/claims.json", import.meta.url))).claims,
  check = name => claims.find(c => c.id === name).check;
test("live build claims bind exact identity bytes/hash/version, never old build constants", () => {
  assert.equal(check("worker-fastfs").bytes,id.worker.bytes);
  assert.equal(check("worker-fastfs").sha256,id.worker.wasm_sha256);
  assert.equal(check("site-hash").contains,id.worker.wasm_sha256.slice(0,8));
  assert.equal(check("contract-wasm-sha").sha256,id.contract.wasm_sha256);
  assert.equal(check("contract-wasm-sha").bytes,id.contract.bytes);
  assert.equal(check("contract-source-version").value,id.contract.version);
  assert.ok(new RegExp(check("worker-deployed").pattern,"m").test(id.worker.wasm_sha256+"\n"));
  assert.ok(!new RegExp(check("worker-deployed").pattern,"m").test("0".repeat(64)+"\n"));
});
