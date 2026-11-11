// P2 old-proof stability: every published output still hashes to the output_hash its attestation
// recorded (pinned from OutLayer on 2026-11-03), and every build that ever served a published call stays
// in the accepted list, so rotating the worker never invalidates an old proof.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonical, buildIndex } from "@/lib/verify";
import { EVIDENCE_IDS } from "@/lib/evidenceIds";
import pinned from "./fixtures/attested-hashes.json";

const dir = new URL("../public/evidence/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const P = pinned as Record<string, { output_hash: string; executed_wasm_sha256: string }>;

describe("old proofs stay valid", () => {
  it("every evidence file has a pinned attestation", () => { for (const f of files) expect(P[f.replace(/\.json$/, "")], f).toBeTruthy(); });
  describe.each(files)("%s", (f) => {
    const id = f.replace(/\.json$/, "");
    const ev = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as { call_id?: string; output: unknown };
    it("output hashes to the attested output_hash", () => {
      expect(createHash("sha256").update(canonical(ev.output)).digest("hex")).toBe(P[id].output_hash.toLowerCase());
    });
    it("its build is still accepted after rotation", () => { expect(buildIndex(P[id].executed_wasm_sha256)).toBeGreaterThanOrEqual(0); });
    it("is listed so /verify loads it", () => { expect(EVIDENCE_IDS.has(id)).toBe(true); });
  });
  it("one changed byte in an output breaks the match (forced failure)", () => {
    const f = files[0]; const id = f.replace(/\.json$/, "");
    const ev = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as { output: unknown };
    const bad = canonical(ev.output).replace(/.$/, " ");
    expect(createHash("sha256").update(bad).digest("hex")).not.toBe(P[id].output_hash);
  });
});

describe("complete pinned build rotation", () => {
  it("keeps d337e822 and cc8d2fa8 historical, never current, and refuses unknown builds", () => {
    expect(buildIndex("d337e822544d31da644728ba794f444f7f3ef6c54a6ee7442ab22d07e049ae41")).toBeGreaterThan(0);
    expect(buildIndex("cc8d2fa8e2e4cc3b05705c5b98ac7eaab0ad119fae1745458a3b733d6270ec4c")).toBeGreaterThan(0);
    expect(buildIndex("0".repeat(64))).toBe(-1);
    expect(buildIndex("015a025906a59f9f40ca17daf2a3c61c5e63a37c081c75230870caa6a82ac443")).toBe(-1);
  });
});
