import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import { ensureCommit, metricsFrom, metricsOk } from "./gen-metrics.mjs";

const commit = "1f628a461b8bd5096974f36da8cae6391b7ea064";
const runId = "ab".repeat(32);

test("a consistent row is accepted, and a drifted total is not", () => {
  const doc = metricsFrom({
    total: 3,
    lines: "web-unit           3",
    commit,
    measuredAt: "2026-11-11T16:00:00Z",
    excluded: "contract,worker,sandbox,playwright",
    runId,
    failed: 0,
  });
  assert.equal(doc.ok, true);
  assert.equal(metricsOk(doc), true);
  assert.equal(metricsOk({ ...doc, total: doc.total + 17 }), false);
  assert.equal(metricsOk({ ...doc, failed: 1 }), false);
  assert.equal(metricsOk({ ...doc, note: "1 failed then projected" }), false);
  assert.throws(() => metricsFrom({ ...{ total: 20, lines: "web-unit           3", commit, measuredAt: "2026-11-11T16:00:00Z", excluded: "contract" } }));
});

test("the recorded artifact names a real commit and its suites sum to the total", () => {
  const doc = JSON.parse(readFileSync(new URL("../docs/metrics.json", import.meta.url), "utf8"));
  assert.equal(metricsOk(doc), true);
  assert.equal(doc.total, 2055);
  assert.equal(doc.suites.cli, 77);
  assert.equal(doc.suites["web-unit"], 1978);
  assert.deepEqual(doc.excluded, ["contract", "worker", "sandbox", "playwright"]);
  assert.equal(doc.failed, 0);
  assert.match(doc.run_id, /^[0-9a-f]{64}$/);
  assert.equal(doc.commit, "8a3c85435b9dc129b457c728c0d8be98a9d572a6");
  assert.doesNotMatch(doc.note, /[1-9]\d* failed|projected/);
  assert.equal(ensureCommit(doc.commit), true);
});

test("a depth-one clone resolves the recorded commit by fetching that object", () => {
  const dir = mkdtempSync(join(tmpdir(), "kh-shallow-"));
  const remote = join(dir, "remote");
  const shallow = join(dir, "shallow");
  execFileSync("git", ["init", "-b", "main", remote]);
  execFileSync("git", ["-C", remote, "config", "user.email", "devmo@example.com"]);
  execFileSync("git", ["-C", remote, "config", "user.name", "devmo"]);
  execFileSync("git", ["-C", remote, "config", "uploadpack.allowReachableSHA1InWant", "true"]);
  writeFileSync(join(remote, "a.txt"), "a\n");
  execFileSync("git", ["-C", remote, "add", "a.txt"]);
  execFileSync("git", ["-C", remote, "commit", "-m", "first"]);
  const first = execFileSync("git", ["-C", remote, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  writeFileSync(join(remote, "a.txt"), "b\n");
  execFileSync("git", ["-C", remote, "add", "a.txt"]);
  execFileSync("git", ["-C", remote, "commit", "-m", "second"]);
  execFileSync("git", ["clone", "--depth", "1", `file://${remote}`, shallow]);
  assert.throws(() => execFileSync("git", ["-C", shallow, "cat-file", "-t", first], { encoding: "utf8" }));
  assert.equal(ensureCommit(first, shallow), true);
});

test("a runner that exits 1 does not write a success artifact", () => {
  const dir = mkdtempSync(join(tmpdir(), "kh-count-"));
  const bin = join(dir, "bin");
  spawnSync("mkdir", ["-p", bin]);
  for (const name of ["cargo", "npm", "npx"]) {
    const path = join(bin, name);
    writeFileSync(path, "#!/bin/sh\necho 'test result: FAILED. 1 failed; 0 passed'\nexit 1\n");
    chmodSync(path, 0o755);
  }
  const out = join(dir, "metrics.json");
  const before = createHash("sha256").update(readFileSync("docs/metrics.json")).digest("hex");
  const r = spawnSync("bash", ["scripts/test-count.sh"], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, METRICS_OUT: out },
    encoding: "utf8",
  });
  const after = createHash("sha256").update(readFileSync("docs/metrics.json")).digest("hex");
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stdout, /TOTAL/);
  assert.equal(existsSync(out), false);
  assert.equal(after, before);
});
