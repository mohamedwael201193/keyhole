import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const capture = () => JSON.parse(readFileSync(join(root, "docs/evidence/live-v2.5/all-live-views.json"), "utf8"));
function fixture(run, historical = true) {
  const dir = mkdtempSync(join(tmpdir(), "keyhole-live-identity-"));
  try {
    for (const p of ["scripts/gen-identity.mjs", "identity.json", "README.md", "contracts/keys/release/v2.5/keyhole_keys.wasm", "contracts/keys/release/v2.5/identity.json", "contracts/keys/release/SHA256SUMS", "contracts/keys/deployed/keyhole_keys.wasm", "contracts/keys/deployed/SHA256SUMS", "web/lib/identity.gen.ts", "tee/worker/DEPLOYED_SHA256"]) {
      mkdirSync(dirname(join(dir, p)), { recursive: true }); copyFileSync(join(root, p), join(dir, p));
    }
    if (historical) {
      // Exercise the legacy validator against an explicit historical identity,
      // never by downgrading the actual v2.6 live identity or removing its guard.
      const p = join(dir, "identity.json"), id = JSON.parse(readFileSync(p));
      id.contract = {...id.contract, version:"2.5.0", bytes:capture().code.bytes,
        wasm_sha256:capture().code.sha256, code_hash:capture().account.code_hash};
      writeFileSync(p, JSON.stringify(id));
    }
    run(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const generate = (dir, data) => {
  writeFileSync(join(dir, "capture.json"), JSON.stringify(data));
  return execFileSync(process.execPath, ["scripts/gen-identity.mjs", "--promote-live", join(dir, "capture.json")], { cwd: dir, stdio: "pipe" });
};
test("historical v2.5 promotion is reproducible from FINAL public evidence", () => fixture(dir => {
  generate(dir, capture());
  const identity = JSON.parse(readFileSync(join(dir, "identity.json"), "utf8"));
  assert.equal(identity.contract.version, "2.5.0");
  assert.equal(identity.contract.bytes, 485855);
  assert.equal(identity.contract.deploy_tx, capture().transactions.deploy.transaction.hash);
  assert.equal(identity.contract.migrate_pledge_tx, capture().transactions.migration.transaction.hash);
  execFileSync(process.execPath, ["scripts/gen-identity.mjs", "--check"], { cwd: dir, stdio: "pipe" });
}));
for (const [name, tamper] of [
  ["unmatched live bytes", c => { c.code.sha256 = "0".repeat(64); }],
  ["pending receipt", c => { c.transactions.migration.final_execution_status = "EXECUTED_OPTIMISTIC"; }],
  ["failed receipt", c => { c.transactions.deploy.receipts_outcome[0].outcome.status = { Failure: "no" }; }],
  ["different deployment bytes", c => { c.transactions.deploy.transaction.actions[0].DeployContract.code = Buffer.alloc(32).toString("base64"); }],
  ["different beneficiary", c => { c.views.find(v => v.method === "get_pledge_config").result.recovery_account = "other.near"; }],
]) test(`promotion refuses ${name} without changing live identity`, () => fixture(dir => {
  const before = readFileSync(join(dir, "identity.json"));
  const data = capture(); tamper(data);
  assert.throws(() => generate(dir, data));
  assert.deepEqual(readFileSync(join(dir, "identity.json")), before);
}));

test("historical promotion cannot downgrade the current v2.6 identity", () => fixture(dir => {
  const before = readFileSync(join(dir, "identity.json"));
  assert.throws(() => generate(dir, capture()), /historical v2.5 path cannot overwrite v2.6 or later/);
  assert.deepEqual(readFileSync(join(dir, "identity.json")), before);
}, false));
