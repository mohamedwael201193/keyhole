// Exact, version-bound migrations for pinned wallet dependencies. No network/code execution.
// Accept only reviewed pristine OR reviewed patched bytes; preflight all files before writing.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
const patches = JSON.parse(readFileSync(new URL("./wallet-dependency-patches.json", import.meta.url), "utf8"));
const sha = source => createHash("sha256").update(source).digest("hex");
const updates = [];
for (const patch of patches) {
  const packages = Object.entries(lock.packages).filter(([path]) => path.endsWith(`/node_modules/${patch.package}`) || path === `node_modules/${patch.package}`);
  if (!packages.length) throw new Error(`Missing migration consumer ${patch.package}`);
  for (const [path, pkg] of packages) {
    if (pkg.version !== patch.version) throw new Error(`Unreviewed ${patch.package}@${pkg.version}`);
    const file = resolve(root, path, patch.file);
    const source = readFileSync(file, "utf8");
    const digest = sha(source);
    if (digest === patch.patched_sha256) continue;
    if (digest !== patch.pristine_sha256) throw new Error(`Migration drift in ${path}/${patch.file}: unknown content`);
    if (source.split(patch.before).length - 1 !== patch.count) throw new Error(`Migration replacement drift in ${path}/${patch.file}`);
    const patched = source.replaceAll(patch.before, patch.after);
    if (sha(patched) !== patch.patched_sha256) throw new Error(`Migration output drift in ${path}/${patch.file}`);
    updates.push({file, patched});
  }
}
for (const {file, patched} of updates) writeFileSync(file, patched);
console.log(`Wallet consumer migrations verified (${updates.length} files updated)`);
