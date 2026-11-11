/**
 * Records a successful test-count run. A failed suite must not reach --write.
 * `node scripts/gen-metrics.mjs --check` fails unless docs/metrics.json says ok.
 */
import { readFileSync, writeFileSync } from "node:fs";

const dest = new URL("../docs/metrics.json", import.meta.url);

export function metricsFrom({ total, lines, commit }) {
  const suites = {};
  for (const line of lines.split("\n")) {
    const m = line.match(/^(\S+)\s+(\d+)\s*$/);
    if (m) suites[m[1]] = Number(m[2]);
  }
  if (!Number.isInteger(total) || total < 0) throw new Error("missing total");
  return {
    ok: true,
    total,
    suites,
    commit: commit || null,
    note: "Recorded only after every suite in this run exited 0. Token reach is feed-derived, not adoption.",
  };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv.includes("--check")) {
  const doc = JSON.parse(readFileSync(dest, "utf8"));
  if (doc.ok !== true || typeof doc.total !== "number" || !doc.suites) {
    console.error("metrics.json is not a successful run");
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv.includes("--write")) {
  const doc = metricsFrom({
    total: Number(arg("--total")),
    lines: arg("--lines") || "",
    commit: arg("--commit") || null,
  });
  writeFileSync(dest, JSON.stringify(doc, null, 2) + "\n");
}
