#!/usr/bin/env node
// Thin alias for judge/check-readme.mjs (same fence run, same exit code).
// Spawns the implementation so its relative resolution stays intact.
// Usage (from a checkout): node verify/check-readme.mjs README.md
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const r = spawnSync(
  process.execPath,
  [path.join(root, "judge", "check-readme.mjs"), ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exit(r.status ?? 1);
