// Reviewed, version-bound migrations for pinned wallet dependencies. No network/code execution.
// npm ci runs this for BOTH browser ESM and Node CJS consumers. Drift fails closed.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
const patches = JSON.parse(readFileSync(new URL("./wallet-dependency-patches.json", import.meta.url), "utf8"));
let applied = 0;
for (const patch of patches) {
  const packages = Object.entries(lock.packages).filter(([path]) => path.endsWith(`/node_modules/${patch.package}`) || path === `node_modules/${patch.package}`);
  if (!packages.length) throw new Error(`Missing migration consumer ${patch.package}`);
  for (const [path, pkg] of packages) {
    if (pkg.version !== patch.version) throw new Error(`Unreviewed ${patch.package}@${pkg.version}`);
    const file = resolve(root, path, patch.file);
    const source = readFileSync(file, "utf8");
    const count = source.split(patch.before).length - 1;
    if (count === 0 && source.split(patch.after).length - 1 === patch.count) continue;
    if (count !== patch.count) throw new Error(`Migration drift in ${path}/${patch.file}: ${count}`);
    writeFileSync(file, source.replaceAll(patch.before, patch.after));
    applied++;
  }
}
console.log(`Wallet consumer migrations verified (${applied} files updated)`);
