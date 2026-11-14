import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "README.md", "SECURITY.md", "THREAT_MODEL.md", "TRACK_COVERAGE.md", "AGENTS.md",
  "VERIFY.md", "PROOFS.md", "tee/worker/README.md", "contracts/keys/README.md", "docs/COSTS_AND_RISK.md",
  "docs/evidence/worker-provisioning/README.md",
];

/** GitHub keeps each remaining space, including the spaces an em dash leaves behind. */
export function slug(heading) {
  return heading
    .replace(/<[^>]+>/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/ /g, "-");
}

function anchors(markdown) {
  const ids = new Set();
  for (const m of markdown.matchAll(/<a\s+id="([^"]+)"/g)) ids.add(m[1]);
  for (const m of markdown.matchAll(/^#{1,6}\s+(.+)$/gm)) ids.add(slug(m[1]));
  return ids;
}

function stripCode(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, "");
}

test("an em dash leaves two hyphens, and repeated spaces stay", () => {
  assert.equal(slug("Pledge reproduction — source candidates and generated live identities"), "pledge-reproduction--source-candidates-and-generated-live-identities");
  assert.equal(slug("Pledge authority graph — code deployed, lending OFF"), "pledge-authority-graph--code-deployed-lending-off");
  assert.equal(slug("a  b"), "a--b");
});

test("relative doc links and anchors resolve", () => {
  const missing = [];
  for (const file of files) {
    const text = stripCode(readFileSync(join(root, file), "utf8"));
    const here = anchors(text);
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const raw = m[1];
      if (/^(https?:|mailto:)/.test(raw)) continue;
      const [pathPart, hash] = raw.split("#");
      if (!pathPart) {
        if (hash && !here.has(hash)) missing.push(`${file} -> #${hash}`);
        continue;
      }
      const target = normalize(join(root, dirname(file), pathPart.split("?")[0]));
      if (!existsSync(target)) {
        missing.push(`${file} -> ${raw}`);
        continue;
      }
      if (hash && target.endsWith(".md")) {
        const ids = anchors(readFileSync(target, "utf8"));
        if (!ids.has(hash)) missing.push(`${file} -> ${raw}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});
