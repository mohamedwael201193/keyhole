import { createHash } from "node:crypto";
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
