#!/usr/bin/env node
// Thin alias for judge/verify-claims.mjs (same checks, same output).
// Spawns the implementation so its relative imports and root resolution stay intact.
// Usage (from a checkout): node verify/verify-claims.mjs [--only <id>] [--offline] [--strict]
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const r = spawnSync(
  process.execPath,
  [path.join(root, "judge", "verify-claims.mjs"), ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exit(r.status ?? 1);
