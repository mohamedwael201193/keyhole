/**
 * Runs only fences marked `<!-- keyhole-fence: safe -->`.
 * Each fence gets a clean directory and a clean environment. The fence's exit code is preserved.
 * A fence that names a paid worker, a mint, or a live refusal is refused before it runs.
 */
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PAID = /live\.mts|4-live-refusals|KEYHOLE_LIVE_OPT_IN|cargo |npm ci|near call|outlayer\.ai\/call/i;

export function safeFences(markdown) {
  const out = [];
  const re = /<!--\s*keyhole-fence:\s*safe\s*-->\s*```(?:bash|sh)?\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(markdown))) out.push(m[1]);
  return out;
}

export function fenceAllowed(body) {
  return !PAID.test(body);
}

export function runFence(body, { timeoutMs = 5_000, env = {} } = {}) {
  if (!fenceAllowed(body)) return Promise.resolve({ code: 2, stdout: "", stderr: "refused: not a safe fence\n" });
  const cwd = mkdtempSync(join(tmpdir(), "kh-fence-"));
  const clean = { PATH: env.PATH || process.env.PATH || "/usr/bin:/bin", HOME: cwd, LANG: "C" };
  return new Promise((resolve) => {
    execFile("bash", ["-lc", body], { cwd, env: clean, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err && (err.killed || err.signal === "SIGTERM")) return resolve({ code: 124, stdout: String(stdout), stderr: String(stderr) });
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
