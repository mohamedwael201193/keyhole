#!/usr/bin/env node
// Execute the exact marked README blocks, not a hand-maintained approximation.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
export function blocks(source) {
  const out = new Map();
  const matches = [...source.matchAll(/<!-- judge:([a-z-]+) -->\r?\n```bash\r?\n([\s\S]*?)\r?\n```/g)];
  for (const [, name, body] of matches) {
    assert.ok(!out.has(name), `duplicate README command block ${name}`);
    assert.ok(['quick','offline','generate','rebuild'].includes(name), `unknown README command block ${name}`);
    out.set(name, body);
  }
  assert.equal((source.match(/^```bash\s*$/gm) || []).length, matches.length, 'every Bash fence must be marked for acceptance testing');
  for (const required of ['quick','offline','generate']) assert.ok(out.has(required), `missing README command block ${required}`);
  return out;
}
export function main(args) {
  const name = (args[0] || '--offline').replace(/^--/, '');
  assert.ok(args.length <= 1 && ['quick','offline','generate','rebuild'].includes(name), 'usage: node judge/check-readme.mjs [--quick|--offline|--generate|--rebuild]');
  const started = Date.now();
  const all = blocks(readFileSync(resolve(ROOT, 'README.md'), 'utf8'));
  assert.ok(all.has(name), `README has no ${name} command block`);
  console.log(`README acceptance: ${name} (clean environment, no inherited credentials)`);
  const result = spawnSync('bash', ['--noprofile', '--norc', '-euo', 'pipefail', '-c', all.get(name)], {
    cwd: ROOT, stdio:'inherit', timeout:600000,
    env:{ HOME:process.env.HOME, PATH:process.env.PATH, LANG:'C.UTF-8' },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `README ${name} commands exited ${result.status}, signal ${result.signal}`);
  console.log(`PASS README ${name} commands (${((Date.now()-started)/1000).toFixed(1)}s)`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`FAIL ${e.message}`); process.exitCode=1; }
}
