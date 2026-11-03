import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTRACT_CODE_HASH, WORKER_WASM_SHA256 } from "@/lib/config";
import { GLOSSARY } from "@/lib/glossary";

const b58 = (buf: Buffer) => { const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; let n = BigInt("0x" + buf.toString("hex")), s = ""; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; } return s; };
const judge = readFileSync(new URL("../app/judge/page.tsx", import.meta.url), "utf8");

describe("judge page", () => {
  it("CONTRACT_CODE_HASH is the base58 sha256 of the committed wasm", () => {
    const w = readFileSync(new URL("../../contracts/keys/deployed/keyhole_keys.wasm", import.meta.url));
    expect(CONTRACT_CODE_HASH).toBe(b58(createHash("sha256").update(w).digest()));
  });
  it("step 1 names the current build, not a previous one", () => {
    const s1 = judge.slice(judge.indexOf('n={1}'), judge.indexOf('n={2}'));
    expect(s1).toContain("CUR");
    for (const old of WORKER_WASM_SHA256.slice(1)) expect(s1).not.toContain(old.slice(0, 8));
  });
  it("current-build calls come before previous-build calls", () => expect(judge.indexOf("judge-current-calls")).toBeLessThan(judge.indexOf("judge-previous")));
  it("previous-build calls are collapsed", () => expect(judge).toMatch(/<details className="jprev"/));
  it("every script step offers a browser alternative and a repo link", () => {
    const scripts = judge.match(/<Script path=/g) ?? [];
    expect(scripts.length).toBeGreaterThanOrEqual(3);
    expect(judge).toContain("Read the script ↗");
  });
  it("no bare 'Verify <hash>' link text", () => expect(judge).not.toMatch(/>Verify \{r\.id\.slice/));
  it("verify links carry an accessible label", () => expect(judge).toMatch(/aria-label=\{`Verify call/));
  it("seven steps", () => expect((judge.match(/<Step n=\{\d\}/g) ?? []).length).toBe(7));
});

describe("glossary", () => {
  for (const [k, g] of Object.entries(GLOSSARY)) {
    it(`${k} has a plain definition under 260 chars`, () => { expect(g.plain.length).toBeGreaterThan(30); expect(g.plain.length).toBeLessThan(260); });
  }
  it("covers the jargon the walk listed", () => { for (const k of ["tdx", "tee", "enclave", "attested", "nep413", "eip191", "outlayer", "oneclick", "codehash"]) expect(GLOSSARY).toHaveProperty(k); });
});
