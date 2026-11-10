import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  releaseGates,
  restoreProbe,
  certificateBytes,
  signature,
  EXECUTION,
} from "./gates.mjs";
import { fixtures, clone } from "./fixtures.mjs";
test("all missing real gates FAIL closed with execution-time labels", async () => {
  const g = await releaseGates();
  assert.equal(g.ready, false);
  assert.equal(g.ready_deploy, false);
  assert.ok(g.rows.every((r) => r.status === "FAIL"));
  assert.ok(
    g.rows
      .filter((r) => r.phase !== "predeploy")
      .every((r) => r.when === EXECUTION),
  );
});
test("complete synthetic evidence exercises every gate positively", async () => {
  const { e, trust, ctx } = fixtures();
  const g = await releaseGates(e, trust, ctx);
  assert.deepEqual(
    g.rows.filter((r) => r.status !== "PASS"),
    [],
  );
  assert.equal(g.ready, true);
});
test("pilot-post freeze is not a prerequisite for ordinary restoration", async () => {
  const { e, trust, ctx } = fixtures("restore");
  delete e.freeze;
  delete e.certificate;
  const g = await releaseGates(e, trust, ctx);
  assert.equal(g.ready_restore, true);
  assert.equal(g.all_mainnet_ready, false);
});
test("UNKNOWN original installation can only complete through successful attested reconciliation", async () => {
  const { e, trust, ctx } = fixtures("provision-post");
  e.install.output.ok = false;
  e.install.output.status = "UNKNOWN";
  assert.equal(
    (await releaseGates(e, trust, ctx)).rows.find(
      (r) => r.name === "configured_auditor_and_sealed_eligibility",
    ).status,
    "PASS",
  );
  e.provision.output.ok = false;
  assert.equal(
    (await releaseGates(e, trust, ctx)).rows.find(
      (r) => r.name === "configured_auditor_and_sealed_eligibility",
    ).status,
    "FAIL",
  );
});
for (const [name, mutate] of Object.entries({
  audit_report: (f) => (f.e.audit.report += "tampered"),
  audit_key: (f) => (f.trust.auditor_public_key = f.trust.release_public_key),
  artifact_signature_commitment: (f) => (f.e.prepare.output.version = 2),
  quorum: (f) => JSON.parse(f.e.prepare.input.auth.message),
  unbacked_funding: (f) =>
    (f.ctx.funding.available_after_storage_and_liabilities = "0"),
  wrong_Q: (f) => (f.e.quote.output.provider_quote_yocto = "1"),
  missing_ledger: (f) => f.e.compute_ledger.pop(),
  unapproved_submitter: (f) => (f.e.pause_acknowledgements = []),
  fake_alias: (f) => (f.ctx.alias_checks[0].status = 200),
  sealed_row: (f) => (f.e.provision.output.eligibility_sealed = false),
  binding: (f) => (f.ctx.binding.encrypted_policy_hash = "bad"),
  lower_policy: (f) => (f.ctx.lower_policy.owner = "wrong.near"),
  freeze_nonce: (f) => (f.ctx.freeze_loan.nonce = "6"),
  freeze_receipt: (f) => f.ctx.freeze_receipts.pop(),
  attestor: (f) =>
    (f.ctx.pledge.attestor_public_key = f.trust.release_public_key),
  secret_refund: (f) =>
    (f.ctx.secret_merge.receipts[0].receipt.Action.actions[0].Transfer.deposit =
      "1"),
  cooldown: (f) =>
    (f.e.inventory.output.withdraw_cooldown_until_ms =
      (f.ctx.now + 100) * 1000),
  pending_approval: (f) =>
    (f.e.inventory.output.obligations = [{ id: "pending", kind: "approval" }]),
  secret_row: (f) => (f.ctx.secret_merge.row.encrypted_sha256 = "bad"),
}))
  test("tampering fails closed: " + name, async () => {
    const stages={audit_report:'provision-pre',audit_key:'provision-pre',artifact_signature_commitment:'provision-pre',quorum:'provision-pre',unbacked_funding:'provision-pre',wrong_Q:'provision-pre',missing_ledger:'provision-pre',unapproved_submitter:'predeploy',fake_alias:'predeploy',sealed_row:'provision-post',binding:'provision-post',lower_policy:'provision-post',secret_refund:'restore',cooldown:'provision-pre',pending_approval:'provision-pre',secret_row:'restore'};
    const f = fixtures(stages[name]||'pilot-post');
    if (name === "quorum") {
      const p = JSON.parse(f.e.prepare.input.auth.message);
      p.params.threshold = 2;
      f.e.prepare.input.auth.message = JSON.stringify(p);
    } else mutate(f);
    assert.equal((await releaseGates(f.e, f.trust, f.ctx)).ready, false);
  });
for (const op of ["account", "info"])
  test(op + " cannot substitute for guarded restore", async () => {
    const f = fixtures("restore");
    f.e.restore.input.op = op;
    f.e.restore.output.op = op;
    await assert.rejects(restoreProbe(f.e.restore, f.ctx));
  });
for (const mutation of [
  (f) => (f.ctx.registry.active_version = "wrong"),
  (f) => (f.ctx.registry.count = 2),
  (f) => {
    f.e.restore.output = {
      ok: false,
      op: "withdraw_dry_run",
      error: "invalid canonical wallet",
    };
  },
  (f) => (f.ctx.control.owner_epoch = "4"),
  (f) => (f.e.restore.output.broadcast = true),
])
  test("bad guarded context/probe never restores", async () => {
    const f = fixtures("restore");
    mutation(f);
    await assert.rejects(restoreProbe(f.e.restore, f.ctx));
  });
test("real WASI operation traverses registry/preflight AND strict canonical wallet before provider quote", () => {
  const source = readFileSync(
    new URL("../../tee/worker/src/collateral_host.rs", import.meta.url),
    "utf8",
  ).split("fn op_withdraw_dry_run(")[1];
  assert.ok(
    source.indexOf("guard_preflight(&c)?") <
      source.indexOf("guarded_wallet(&c.token_id())?"),
  );
  assert.ok(
    source.indexOf("guarded_wallet(&c.token_id())?") < source.indexOf('"POST"'),
  );
  assert.doesNotMatch(source, /begin_value_op|native_send::/);
  const guard = readFileSync(
    new URL("../../tee/worker/src/guarded_host.rs", import.meta.url),
    "utf8",
  );
  assert.match(guard, /guard_registry/);
});
test("certificate encoder/signature matches exact Rust Borsh golden fixture", () => {
  const f = JSON.parse(
    readFileSync(
      new URL(
        "../../protocol/loan-certificate-v3-delivery.json",
        import.meta.url,
      ),
    ),
  );
  assert.equal(certificateBytes(f.certificate).toString("hex"), f.borsh_hex);
  assert.equal(
    signature(f.public_key, certificateBytes(f.certificate), f.signature),
    true,
  );
  const c = clone(f.certificate);
  c.owner_epoch = "1";
  assert.equal(
    signature(f.public_key, certificateBytes(c), f.signature),
    false,
  );
});
for (const [name, patch] of [
  ["executed hash", { executed_wasm_sha256: "0".repeat(64) }],
  ["input hash", { input_hash: "0".repeat(64) }],
  ["output hash", { output_hash: "0".repeat(64) }],
  ["stale attestation", { timestamp: 1 }],
])
  test("restore rejects forged " + name, async () => {
    const f = fixtures("restore"),
      fetch = f.ctx.fetchAttestation;
    f.ctx.fetchAttestation = async (id) => ({ ...(await fetch(id)), ...patch });
    await assert.rejects(restoreProbe(f.e.restore, f.ctx));
  });
