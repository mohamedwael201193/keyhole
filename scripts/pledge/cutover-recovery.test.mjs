import { test } from "node:test";
import assert from "node:assert/strict";
import { cutoverNext } from "./cutover-recovery.mjs";
import { fixtures } from "../release/fixtures.mjs";
import { WORKER } from "../release/promotion-lib.mjs";
const old = Array.from({ length: 22 }, (_, i) =>
  i.toString(16).padStart(64, "0"),
);
const plan = { hash: WORKER, retired: old, previous_active: old[21] };
const base = {
  maintenance_enforced: true,
  old_jobs_drained: true,
  uuid: "p000000000000004b",
  versions: old,
  active: old[21],
  upload_verified: true,
  secret_hash: plan.hash,
};
test("resume every atomic registry milestone without repeating successful batches", async () => {
  for (const [versions, n] of [
    [old, 1],
    [[plan.hash, ...old.slice(4)], 2],
    [[plan.hash, ...old.slice(13)], 3],
  ])
    assert.equal(
      (
        await cutoverNext(plan, {
          ...base,
          versions,
          active: n === 1 ? old[21] : plan.hash,
        })
      ).next,
      `registry_batch_${n}`,
    );
});
test("interruption before upload and secret merge remains in maintenance", async () => {
  assert.equal(
    (await cutoverNext(plan, { ...base, upload_verified: false })).next,
    "verify_or_finish_original_upload",
  );
  assert.equal(
    (await cutoverNext(plan, { ...base, secret_hash: "old" })).next,
    "merge_secrets_once_after_original_terminal_gate",
  );
});
test("UNKNOWN, missing barrier, partial registry or namespace mismatch never resumes sends", async () => {
  for (const bad of [
    { unresolved_original: true },
    { maintenance_enforced: false },
    { old_jobs_drained: false },
    { uuid: "other" },
    { versions: old.slice(1) },
    { active: old[20] },
  ])
    assert.equal((await cutoverNext(plan, { ...base, ...bad })).next, "STOP");
});
const ready = (probe, info) => ({
  ...base,
  versions: [WORKER],
  active: WORKER,
  runtime: {
    attested_hash: WORKER,
    guarded_holder_read: true,
    minter_attestor_continuity: true,
    frontend_compatible: true,
    lending_disabled: true,
    probe,
    info,
  },
});
test("forged legacy Boolean cannot reopen without real guarded attestation", async () => {
  assert.equal(
    (
      await cutoverNext(plan, ready(), {
        context: async () => {
          throw Error("no real probe");
        },
      })
    ).next,
    "verify_restore_service",
  );
});
test("fresh attested guarded withdraw preview restores after all client gates", async () => {
  const { e, ctx } = fixtures();
  assert.deepEqual(
    await cutoverNext(plan, ready(e.restore, e.info), {
      context: async () => ctx,
    }),
    { next: "reopen_admission", maintenance: false },
  );
});
for (const [name, change] of [
  ["wrong expected hash", (f) => (f.ctx.registry.active_version = "bad")],
  ["multiple versions", (f) => (f.ctx.registry.count = 2)],
  [
    "invalid canonical wallet",
    (f) => {
      f.e.restore.output.ok = false;
      f.e.restore.output.error = "invalid canonical wallet";
    },
  ],
  [
    "account compatibility read",
    (f) => {
      f.e.restore.input.op = "account";
      f.e.restore.output.op = "account";
    },
  ],
  [
    "info read",
    (f) => {
      f.e.restore.input.op = "info";
      f.e.restore.output.op = "info";
    },
  ],
])
  test(name + " cannot mark restore-ready", async () => {
    const f = fixtures();
    change(f);
    assert.equal(
      (
        await cutoverNext(plan, ready(f.e.restore, f.e.info), {
          context: async () => f.ctx,
        })
      ).next,
      "verify_restore_service",
    );
  });
