import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import { metricsFrom, metricsOk } from "./gen-metrics.mjs";

const commit = "1f628a461b8bd5096974f36da8cae6391b7ea064";

test("a consistent row is accepted, and a drifted total is not", () => {
  const doc = metricsFrom({
    total: 3,
    lines: "web-unit           3",
    commit,
    measuredAt: "2026-11-11T16:00:00Z",
    excluded: "contract,worker,sandbox,playwright",
  });
  assert.equal(doc.ok, true);
  assert.equal(metricsOk(doc), true);
  assert.equal(metricsOk({ ...doc, total: doc.total + 17 }), false);
  assert.throws(() => metricsFrom({ ...{ total: 20, lines: "web-unit           3", commit, measuredAt: "2026-11-11T16:00:00Z", excluded: "contract" } }));
});

test("the recorded artifact names a real commit and its suites sum to the total", () => {
  const doc = JSON.parse(readFileSync(new URL("../docs/metrics.json", import.meta.url), "utf8"));
  assert.equal(metricsOk(doc), true);
  assert.equal(doc.total, 2055);
  assert.equal(doc.suites.cli, 77);
  assert.equal(doc.suites["web-unit"], 1978);
  assert.deepEqual(doc.excluded, ["contract", "worker", "sandbox", "playwright"]);
  assert.equal(execFileSync("git", ["cat-file", "-t", doc.commit], { encoding: "utf8" }).trim(), "commit");
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
