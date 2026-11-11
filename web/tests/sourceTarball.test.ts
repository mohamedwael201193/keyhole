import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { canonical } from "@/lib/verify";
import { IDENTITY } from "@/lib/identity.gen";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
  const att = JSON.parse(packed("web/tests/fixtures/att_962d4374.json").toString());
  expect(evidence.call_id).toBe(IDENTITY.worker.info_call);
  expect(createHash("sha256").update(canonical(evidence.output)).digest("hex")).toBe(att.output_hash);
  expect(packed("web/lib/evidenceIds.ts").toString()).toContain(IDENTITY.worker.info_call);
});
