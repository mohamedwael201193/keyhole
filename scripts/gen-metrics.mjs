/**
 * Records a successful test-count run. A failed suite must not reach --write.
 * `node scripts/gen-metrics.mjs --check` fails unless the artifact is a consistent success.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const destDefault = new URL("../docs/metrics.json", import.meta.url);

export function metricsFrom({ total, lines, commit, measuredAt, excluded }) {
  const suites = {};
  for (const line of String(lines || "").split("\n")) {
    const m = line.match(/^(\S+)\s+(\d+)\s*$/);
    if (m) suites[m[1]] = Number(m[2]);
  }
  const names = Object.keys(suites);
  const sum = names.reduce((n, k) => n + suites[k], 0);
  const skip = String(excluded || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!Number.isInteger(total) || total < 0 || total !== sum) throw new Error("total does not match suites");
  if (!/^[0-9a-f]{40}$/.test(commit || "")) throw new Error("missing commit");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(measuredAt || "")) throw new Error("missing measured_at");
  if (!skip.length || skip.some((name) => name in suites)) throw new Error("excluded suites");
  return {
    ok: true,
    total,
    suites,
    excluded: skip,
    commit,
    measured_at: measuredAt,
    runners: {
      cli: "cd cli && npm test",
      "web-unit": "cd web && npx vitest run",
      contract: "cd contracts/keys && cargo test --locked",
      worker: "cd tee/worker && cargo test --locked",
    },
    note: "ok is true only when every invoked runner exited 0 and total equals the sum of suites. Suites listed in excluded were not run for this file and are not in total. Token reach is feed-derived, not adoption. A CI log count is not a row in this file.",
  };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fileUrl() {
  const named = arg("--file");
  return named ? named : destDefault;
}

export function metricsOk(doc) {
  if (!doc || doc.ok !== true || !doc.suites || typeof doc.total !== "number") return false;
  const sum = Object.values(doc.suites).reduce((n, v) => n + Number(v), 0);
  if (doc.total !== sum) return false;
  if (!/^[0-9a-f]{40}$/.test(doc.commit || "")) return false;
  if (typeof doc.measured_at !== "string" || !doc.measured_at) return false;
  if (!Array.isArray(doc.excluded) || doc.excluded.length === 0) return false;
  if (doc.excluded.some((name) => name in doc.suites)) return false;
  return true;
}

if (process.argv.includes("--check")) {
  const doc = JSON.parse(readFileSync(fileUrl(), "utf8"));
  if (!metricsOk(doc)) {
    console.error("metrics.json is not a consistent successful run");
    process.exit(1);
  }
  const seen = spawnSync("git", ["cat-file", "-t", doc.commit], { encoding: "utf8" });
  if (seen.status !== 0 || seen.stdout.trim() !== "commit") {
    console.error("metrics commit is not in this repository");
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv.includes("--write")) {
  const doc = metricsFrom({
    total: Number(arg("--total")),
    lines: arg("--lines") || "",
    commit: arg("--commit") || "",
    measuredAt: arg("--measured-at") || "",
    excluded: arg("--excluded") || "",
  });
  const target = fileUrl();
  writeFileSync(target, JSON.stringify(doc, null, 2) + "\n");
}
