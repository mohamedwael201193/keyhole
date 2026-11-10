/**
 * Runs the primary README fence against a clean clone.
 * `main` has no judge/0-live.sh. The fence must check out the branch that does.
 * The clone is a separate work tree, so a dirty checkout of this repo is not what the test sees.
 * `bash judge/0-live.sh` is the fence's last command and is read-only public RPC.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = decodeURIComponent(new URL("..", import.meta.url).pathname);
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const section = readme.split("## 1. Verify in 5 minutes")[1].split("## ")[0];
const fence = section.split("```bash\n")[1].split("```")[0].trim();
const lines = fence.split("\n").map((l) => l.trim()).filter(Boolean);

test("primary fence checks out the branch that contains the judge script", () => {
  assert.match(lines[0], /^git clone --depth 1 --branch fix\/int196-r2 https:\/\/github\.com\/mohamedwael201193\/keyhole\.git$/);
  assert.equal(lines[1], "cd keyhole");
  assert.equal(lines[2], "test -f judge/0-live.sh");
  assert.equal(lines[3], "bash judge/0-live.sh");
  assert.doesNotMatch(fence, /git clone --depth 1 https:\/\/github\.com\/mohamedwael201193\/keyhole(?:\.git)?\s+&&/);
});

test("exact clone of this branch has the script; main does not", { timeout: 180_000 }, () => {
  const parent = mkdtempSync(join(tmpdir(), "kh-judge-"));
  try {
    const source = join(parent, "source");
    execFileSync("git", ["clone", "--local", repo, source], { stdio: "pipe" });
    // A CI checkout is often detached. The fence names this branch, so the source must have that ref at HEAD.
    execFileSync("git", ["checkout", "-B", "fix/int196-r2"], { cwd: source, stdio: "pipe" });
    const run = join(parent, "run");
    execFileSync("mkdir", ["-p", run]);
    execFileSync("git", ["clone", "--depth", "1", "--branch", "fix/int196-r2", source, "keyhole"], { cwd: run, stdio: "pipe" });
    const checkout = join(run, "keyhole");
    execFileSync("test", ["-f", "judge/0-live.sh"], { cwd: checkout });
    execFileSync("test", ["-f", "judge/receipt_proof.py"], { cwd: checkout });
    execFileSync("bash", ["judge/0-live.sh"], { cwd: checkout, stdio: "pipe", timeout: 120_000 });
    execFileSync("git", ["clone", "--depth", "1", "--branch", "main", "https://github.com/mohamedwael201193/keyhole.git", "main-checkout"], { cwd: run, stdio: "pipe", timeout: 120_000 });
    let missing = false;
    try { execFileSync("test", ["-f", "main-checkout/judge/0-live.sh"], { cwd: run }); }
    catch { missing = true; }
    assert.equal(missing, true);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
