import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { canonical } from "@/lib/verify";
import { IDENTITY } from "@/lib/identity.gen";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
const repo = fileURLToPath(new URL("../..", import.meta.url));
// Files the publisher commit may change when it records review.source_commit.
// Anything else must already be in the pinned snapshot a judge checks out.
const PIN_FILES = new Set([
  "identity.json",
  "web/lib/identity.gen.ts",
  "README.md",
  "web/public/source/keyhole-src.tar.gz",
  "web/public/source/keyhole-src.tar.gz.sha256",
  "web/public/source/manifest.json",
]);
const GUARD = "pinned source matches HEAD except the pin files";
function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}
function hasCommit(rev: string): boolean {
  try {
    git(["cat-file", "-e", `${rev}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}
function fileAt(rev: string, path: string): string | null {
  try {
    return execFileSync("git", ["show", `${rev}:${path}`], { cwd: repo, encoding: "utf8" });
  } catch {
    return null;
  }
}
const dir = `${__dirname}/../public/source`;
describe("judge source tarball", () => {
  it("manifest, .sha256 file and the tarball bytes agree", () => {
    const tgz = readFileSync(`${dir}/keyhole-src.tar.gz`);
    const sha = createHash("sha256").update(tgz).digest("hex");
    const m = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
    expect(m.sha256).toBe(sha);
    expect(m.bytes).toBe(tgz.length);
    expect(m.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(readFileSync(`${dir}/keyhole-src.tar.gz.sha256`, "utf8")).toBe(`${sha}  keyhole-src.tar.gz\n`);
  });
});

// git archive writes ordinary POSIX tar records; read only named public files.
function packed(path: string): Buffer {
  const tar = gunzipSync(readFileSync(`${dir}/keyhole-src.tar.gz`));
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = tar.toString("utf8", offset, offset + 100).split("\0")[0];
    if (!name) break;
    const size = parseInt(tar.toString("ascii", offset + 124, offset + 136).replace(/\0/g, "").trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0) throw Error("invalid tar size");
    const start = offset + 512;
    if (name === `keyhole/${path}`) return tar.subarray(start, start + size);
    offset = start + Math.ceil(size / 512) * 512;
  }
  throw Error(`missing packed ${path}`);
}
it("ships the same live identities, immutable source pin and registered default proof", () => {
  const man = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
  expect(man.commit).toBe(IDENTITY.review.source_commit);
  const identity = JSON.parse(packed("identity.json").toString());
  expect(identity.worker).toEqual(IDENTITY.worker);
  expect(identity.contract).toEqual(IDENTITY.contract);
  const evidence = JSON.parse(packed(`web/public/evidence/${IDENTITY.worker.info_call}.json`).toString());
  const att = JSON.parse(packed(`web/tests/fixtures/att_${IDENTITY.worker.info_call.slice(0, 8)}.json`).toString());
  expect(evidence.call_id).toBe(IDENTITY.worker.info_call);
  expect(createHash("sha256").update(canonical(evidence.output)).digest("hex")).toBe(att.output_hash);
  expect(packed("web/lib/evidenceIds.ts").toString()).toContain(IDENTITY.worker.info_call);
});

it(GUARD, () => {
  const pinned = IDENTITY.review.source_commit;
  expect(pinned).toMatch(/^[0-9a-f]{40}$/);
  const head = git(["rev-parse", "HEAD"]);
  if (head === pinned) return;
  if (!hasCommit(pinned)) git(["fetch", "--depth", "1", "origin", pinned]);
  const names = git(["diff-tree", "--no-commit-id", "-r", "--name-only", pinned, head])
    .split("\n").map((s) => s.trim()).filter(Boolean);
  const extra = names.filter((n) => !PIN_FILES.has(n));
  const pinnedHasGuard = (fileAt(pinned, "web/tests/sourceTarball.test.ts") ?? "").includes(GUARD);
  if (!pinnedHasGuard) {
    // This checkout still records the previous archive. That is valid only while
    // the guard is being added. A later commit must name a snapshot that contains it.
    let parentHasGuard = false;
    try {
      const parent = git(["rev-parse", "--verify", "HEAD^"]);
      if (!hasCommit(parent)) git(["fetch", "--depth", "1", "origin", parent]);
      parentHasGuard = (fileAt(parent, "web/tests/sourceTarball.test.ts") ?? "").includes(GUARD);
    } catch {
      parentHasGuard = false;
    }
    expect(parentHasGuard, "review.source_commit moved off a guarded snapshot").toBe(false);
    return;
  }
  expect(extra, `pinned ${pinned} differs from HEAD outside the pin files:\n${extra.join("\n")}`).toEqual([]);
});
