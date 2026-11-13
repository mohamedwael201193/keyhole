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
  assert.equal(id.worker.previous_wasm_sha256,"ed0f614acd83c8dc4851901206f5e5f065a3a6e7731cf8cc8d6a3e2bfd66a1b8");
  for (const h of ["de9e3005614bbd140f86ca4dd345efc945187dbf09de320ed5483840dcc076b5","114dff5afb2b0df038a456594cc91a810da6907e1e8710bf98283fb4d02606d6","34bf835cea7c9977bbd3270851eb27290dd35db4a0afa4652161664f57fc7d01"]) assert.ok(id.worker.historical_wasm_sha256.includes(h));
  assert.ok(id.worker.historical_wasm_sha256.includes("62398a8aa0451ce58cb5ab814ad8dc7f4e2f3fc55ce874c7672ea986abcc307f"));
  assert.ok(!id.worker.historical_wasm_sha256.includes("0".repeat(64)));
});
