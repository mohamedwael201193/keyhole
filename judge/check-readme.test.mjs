import assert from "node:assert/strict";
import test from "node:test";
import { fenceAllowed, runFence, safeFences } from "./check-readme.mjs";

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
