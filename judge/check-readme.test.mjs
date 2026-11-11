import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { documentFences, fenceAllowed, runFence, safeFences } from "./check-readme.mjs";

test("only a marked safe fence is collected, and a paid command is refused", async () => {
  const md = "```bash\necho skipped\n```\n<!-- keyhole-fence: safe -->\n```bash\necho fence-ok\n```\n<!-- keyhole-fence: safe -->\n```bash\nnode judge/live.mts\n```\n";
  const fences = safeFences(md);
  assert.equal(fences.length, 2);
  assert.equal(fenceAllowed(fences[0]), true);
  assert.equal(fenceAllowed(fences[1]), false);
  const paid = await runFence(fences[1]);
  assert.equal(paid.code, 2);
});

test("a safe fence keeps its exit code, sees a clean env, and times out", async () => {
  const ok = await runFence("test -z \"${KEYHOLE_SENTINEL-}\"; echo fence-ok\n", { env: { PATH: process.env.PATH, KEYHOLE_SENTINEL: "leak" } });
  assert.equal(ok.code, 0);
  assert.match(ok.stdout, /fence-ok/);
  const bad = await runFence("exit 3\n");
  assert.equal(bad.code, 3);
  const slow = await runFence("sleep 30\n", { timeoutMs: 200 });
  assert.equal(slow.code, 124);
});

test("the README checkout fence is the one the runner executes", async () => {
  const rows = documentFences(["README.md"]).filter((row) => row.body.includes("git fetch --depth 1 origin"));
  assert.equal(rows.length, 1);
  assert.equal(rows.every((row) => fenceAllowed(row.body)), true);
  const ran = await runFence(rows[0].body, { timeoutMs: 120_000 });
  assert.equal(ran.code, 0);
  assert.equal(safeFences(readFileSync("VERIFY.md", "utf8")).length, 0);
});
