import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const section = readme.split("## Pledge preparation — v2.5 source, NOT deployed")[1];
const fence = section.split("```bash\n")[1].split("```")[0];
test("full reproduction builds the untracked callback fixture before the sandbox", () => {
  const build = fence.indexOf("./build.sh --features callback-failure-fixture");
  const copy = fence.indexOf("cp target/near/keyhole_keys.wasm ../keys-sandbox/tests/fixtures/callback_failure.wasm");
  const normal = fence.indexOf("&& ./build.sh && cmp target/near/keyhole_keys.wasm release/v2.5/keyhole_keys.wasm", copy);
  const sandbox = fence.indexOf("cd contracts/keys-sandbox");
  assert.ok(build >= 0 && copy > build && normal > copy && sandbox > normal);
  assert.match(fence, /build-policy-mock\.sh && cargo test --locked -- --test-threads=1/);
  assert.equal((readme.match(/cp target\/near\/keyhole_keys\.wasm \.\.\/keys-sandbox\/tests\/fixtures\/callback_failure\.wasm/g) || []).length, 1);
});
test("full reproduction compiles the WASI host, not just native cfg", () => {
  assert.match(fence, /cargo clippy --locked --target wasm32-wasip2 -- -D warnings && \.\/build\.sh/);
  assert.match(fence, /export CARGO_BUILD_JOBS=1 NODE_OPTIONS=--max-old-space-size=3072/);
});
