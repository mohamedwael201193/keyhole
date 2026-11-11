import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const section = readme.split("## Pledge reproduction —")[1];
const fence = section.split("```bash\n")[1].split("```")[0];
test("full reproduction builds the untracked callback fixture before the sandbox", () => {
  const build = fence.indexOf("./build.sh --features callback-failure-fixture");
  const copy = fence.indexOf("cp target/near/keyhole_keys.wasm ../keys-sandbox/tests/fixtures/callback_failure.wasm");
  const normal = fence.indexOf("&& ./build.sh && cmp target/near/keyhole_keys.wasm release/v2.7/keyhole_keys.wasm && ./build-sandbox-delay.sh", copy);
  const sandbox = fence.indexOf("cd contracts/keys-sandbox");
  assert.ok(build >= 0 && copy > build && normal > copy && sandbox > normal);
  assert.match(fence, /build-policy-mock\.sh && cargo test --locked -- --test-threads=1/);
  assert.equal((readme.match(/cp target\/near\/keyhole_keys\.wasm \.\.\/keys-sandbox\/tests\/fixtures\/callback_failure\.wasm/g) || []).length, 1);
});
test("full reproduction compiles the WASI host, not just native cfg", () => {
  assert.match(fence, /cargo clippy --locked --target wasm32-wasip2 -- -D warnings && \.\/build\.sh/);
  assert.match(fence, /export CARGO_BUILD_JOBS=1 NODE_OPTIONS=--max-old-space-size=3072/);
});

test("judge checkout and raw paths share an immutable generated source ref", () => {
  const id = JSON.parse(readFileSync(new URL("../identity.json", import.meta.url), "utf8"));
  assert.match(id.review.source_commit, /^[0-9a-f]{40}$/);
  assert.equal((readme.match(new RegExp(`git fetch --depth 1 origin ${id.review.source_commit}`, "g")) || []).length, 2);
  assert.equal((readme.match(new RegExp(`raw.githubusercontent.com/mohamedwael201193/keyhole/${id.review.source_commit}/`, "g")) || []).length, 3);
  assert.doesNotMatch(readme, /git clone[^\n]*--branch|raw\.githubusercontent\.com\/mohamedwael201193\/keyhole\/integration\//);
});

test("all current README claim-count rows match actual offline verification", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const output = execFileSync(process.execPath, ["judge/verify-claims.mjs", "--offline"], {cwd:root,encoding:"utf8"});
  const match = output.match(/(\d+) claims: (\d+) PASS, 0 FAIL, 0 ERROR, (\d+) SKIP/);
  assert.ok(match, output.slice(-500));
  const [,total,pass,skip] = match;
  assert.ok(readme.includes(`${total} claims: ${pass} PASS, 0 FAIL, 0 ERROR, ${skip} SKIP`));
  assert.ok(readme.includes(`Judge-claims machine (${total} claims)`));
  assert.ok(readme.includes(`**${total}**: offline ${pass} PASS, 0 FAIL, 0 ERROR, ${skip} SKIP`));
});

test("live and source candidates stay distinct and presentation has no visible dates", () => {
  const visible = readme.replace(/\]\([^\n]*?\)/g, "](...)");
  assert.doesNotMatch(visible, /\b20\d{2}-\d{2}-\d{2}\b/);
  assert.doesNotMatch(visible, /health FAIL|result remains the FAIL|mainnet remains v2\.4|v2\.4[^\n]*live now/);
  assert.match(readme, /Contract source candidate \*\*2\.7\.0\*\*, matches live deployment/);
  assert.doesNotMatch(readme, /staged for deploy, not live/);
  assert.match(readme, /worker-provisioning\/R2\.md/);
});
