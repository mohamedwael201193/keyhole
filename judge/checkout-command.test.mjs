/** Execute the generated immutable checkout recipe, never a mutable branch. */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("..", import.meta.url));
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const id = JSON.parse(readFileSync(new URL("../identity.json", import.meta.url), "utf8"));
const ref = id.review.source_commit;
const section = readme.split("## Try it (5 minutes)")[1].split("## ")[0];
const fence = section.split("```bash\n")[1].split("```")[0].trim();
const remote = "https://github.com/mohamedwael201193/keyhole.git";
test("primary recipe fetches and checks the full immutable source commit", () => {
  assert.match(ref, /^[0-9a-f]{40}$/);
  assert.equal(fence, `git init keyhole && cd keyhole\ngit remote add origin ${remote}\ngit fetch --depth 1 origin ${ref}\ngit checkout --detach FETCH_HEAD\ntest "$(git rev-parse HEAD)" = "${ref}"`);
  assert.doesNotMatch(fence, /--branch/);
});
test("exact generated checkout contains byte-identical script, receipt checker and identity", {timeout:180_000}, () => {
  const parents = [];
  try {
    let source = repo;
    // A hosted shallow checkout may not have its pinned source ancestor locally yet.
    try { execFileSync("git", ["cat-file", "-e", `${ref}^{commit}`], {cwd:repo,stdio:"pipe"}); }
    catch { source = remote; }
    const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
    const attempt = (src) => {
      const parent = mkdtempSync(join(tmpdir(), "kh-judge-ref-"));
      parents.push(parent);
      execFileSync("bash", ["-eu", "-c", fence.replace(remote, quote(src))], {cwd:parent,stdio:"pipe",timeout:120_000});
      return join(parent, "keyhole");
    };
    let checkout;
    try {
      checkout = attempt(source);
    } catch (e) {
      // A partial clone cannot serve a fetch of the pinned commit (its
      // promisor objects are unavailable to upload-pack); the fence itself
      // is what is under test, so retry once against the real remote.
      if (source === remote) throw e;
      checkout = attempt(remote);
    }
    for (const file of ["judge/0-live.sh","judge/receipt_proof.py","identity.json"]) {
      const checked = readFileSync(join(checkout,file));
      const committed = execFileSync("git", ["show",`${ref}:${file}`], {cwd:checkout});
      assert.deepEqual(checked, committed);
    }
    assert.equal(execFileSync("git", ["rev-parse","HEAD"], {cwd:checkout,encoding:"utf8"}).trim(),ref);
  } finally { for (const p of parents) rmSync(p,{recursive:true,force:true}); }
});
