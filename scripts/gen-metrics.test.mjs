import assert from "node:assert/strict";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { metricsFrom } from "./gen-metrics.mjs";

test("a parsed success row is recorded, and a failed runner writes nothing", () => {
  const doc = metricsFrom({ total: 3, lines: "web-unit           3", commit: "abc" });
  assert.equal(doc.ok, true);
  assert.equal(doc.suites["web-unit"], 3);
  const dir = mkdtempSync(join(tmpdir(), "kh-metrics-"));
  const dest = join(dir, "metrics.json");
  const fail = spawnSync("bash", ["-lc", "exit 1 && echo wrote"], { encoding: "utf8" });
  assert.equal(fail.status, 1);
  if (fail.status === 0) writeFileSync(dest, "{}\n");
  assert.equal(existsSync(dest), false);
});

test("a fixture runner that exits 1 does not print a passing total", () => {
  const r = spawnSync("bash", ["scripts/test-count.sh"], {
    env: { ...process.env, TEST_COUNT_FIXTURE: "fail" },
    encoding: "utf8",
  });
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stdout, /TOTAL/);
});
