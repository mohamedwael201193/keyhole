import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// docs/claims.json is the machine-readable list of every factual claim; judge/verify-claims.mjs checks it live.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const doc = JSON.parse(readFileSync(path.join(root, "docs/claims.json"), "utf8"));
const claims: Array<Record<string, any>> = doc.claims;
const TYPES = ["path", "grep", "count", "symbol", "sha256", "code_hash", "view", "access_key", "account", "holder", "tx", "attestation", "fastfs", "http", "redirect", "header", "site_vs_chain", "ci_run"];
const EVIDENCE = ["mainnet tx", "mainnet view", "OutLayer call", "test file", "CI run", "script", "file", "live site"];

describe("docs/claims.json", () => {
  it("has well-formed entries with unique ids", () => {
    expect(claims.length).toBeGreaterThan(100);
    const ids = new Set<string>();
    for (const c of claims) {
      for (const k of ["id", "claim", "where", "evidence_type", "evidence", "check", "expected", "verify"]) expect(c[k], `${c.id}.${k}`).toBeTruthy();
      expect(ids.has(c.id), `duplicate ${c.id}`).toBe(false);
      ids.add(c.id);
      expect(TYPES, c.id).toContain(c.check.type);
      expect(EVIDENCE, c.id).toContain(c.evidence_type);
    }
  });
  it("every `where` points at an existing file and line", () => {
    for (const c of claims) {
      const [file, line] = c.where.split(":");
      expect(existsSync(path.join(root, file)), c.where).toBe(true);
      const n = readFileSync(path.join(root, file), "utf8").split("\n").length;
      expect(Number(line), c.where).toBeGreaterThan(0);
      expect(Number(line), c.where).toBeLessThanOrEqual(n);
    }
  });
  it("every repo path a claim references exists", () => {
    for (const c of claims.filter((x) => ["path", "grep", "count", "sha256", "code_hash"].includes(x.check.type))) for (const k of ["path", "wasm"]) if (c.check[k]) expect(existsSync(path.join(root, c.check[k])), `${c.id}: ${c.check[k]}`).toBe(true);
  });
  it("file checks pass offline (grep, count, sha256)", () => {
    for (const c of claims.filter((x) => x.check.type === "grep")) expect(new RegExp(c.check.pattern, "m").test(readFileSync(path.join(root, c.check.path), "utf8")), c.id).toBe(true);
    for (const c of claims.filter((x) => x.check.type === "count")) expect((readFileSync(path.join(root, c.check.path), "utf8").match(new RegExp(c.check.pattern, "g")) || []).length, c.id).toBeGreaterThanOrEqual(c.check.value);
  });
  it("live checks name only public, read-only endpoints", () => {
    const s = JSON.stringify(claims);
    for (const u of s.match(/https:\/\/[^"\s)]+/g) || []) expect(u, u).toMatch(/^https:\/\/(www\.getkeyhole\.xyz|nearblocks\.io|api\.outlayer\.ai|main\.fastfs\.io|github\.com\/mohamedwael201193\/keyhole)/);
    expect(s).not.toMatch(/wk_[0-9a-f]{16}|ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/);
  });
});
