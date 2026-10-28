import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillPath = join(cliRoot, "..", "skills", "keyhole", "SKILL.md");

/** Command lines printed by `keyhole help`, in order. */
function helpCommands(): string[] {
  const r = spawnSync("npx", ["tsx", "src/cli.ts", "help"], { cwd: cliRoot, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.split("\n").map((s) => s.trim()).filter((s) => /^keyhole\s+\S/.test(s));
}

test("skills/keyhole/SKILL.md lists the same commands as keyhole help", () => {
  const skill = readFileSync(skillPath, "utf8");
  const fence = skill.match(/```text\n([\s\S]*?)```/);
  assert.ok(fence, "SKILL.md needs one ```text fence with the CLI help lines");
  const listed = fence[1].split("\n").map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(listed, helpCommands());
});
