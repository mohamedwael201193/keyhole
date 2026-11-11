import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const identity = JSON.parse(read("../identity.json"));
const readme = read("../README.md");
const track = read("../TRACK_COVERAGE.md");
const judge = read("../JUDGE_AGENT.md");
const verify = read("../VERIFY.md");

test("live identity and the docs that quote it say v2.7", () => {
  assert.equal(identity.contract.version, "2.7.0");
  assert.equal(identity.contract.code_hash, "3cZsaySYgqZntFaRKEUffQUMGqRjkQ2DuSmFWXwiKGZH");
  assert.match(readme, /Live contract v2\.7/);
  assert.doesNotMatch(readme, /staged for deploy, not live/);
  assert.doesNotMatch(readme, /What is left open/);
  assert.match(track, /contract v2\.7/);
  assert.match(judge, /VERIFY\.md/);
  assert.doesNotMatch(judge, /fix\/int196-r2/);
  assert.doesNotMatch(verify, /main does not contain/);
  assert.match(readme, /ownership-and-limits/);
  assert.doesNotMatch(readme, /keeps no record of who the holder is/);
  assert.match(readme, /internal reproducible review|Internally reviewed/i);
});
