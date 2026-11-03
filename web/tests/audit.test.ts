import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { attestChecks, verdict, clientIp, safeAttPath } from "@/lib/verifyScore";
import { createLimiter } from "@/lib/ratelimit";
import { WORKER_PUBLISH_TX, WORKER_WASM_SHA256 } from "@/lib/config";
import { WORKER_ERROR_CODES, isKnownCode } from "@/lib/errors";
import en from "@/messages/en.json";

const good = { quote: true, registered: true, fastfs: true, published: true, binding: { match: true } };
describe("audit 2026-11-03: /verify fails closed", () => {
  it("a missing output row is not counted", () => { expect(attestChecks({ ...good, output: null })).toHaveLength(5); });
  it("a matched output row counts as a pass", () => { expect(attestChecks({ ...good, output: { match: true } })).toEqual([true, true, true, true, true, true]); });
  it("a mismatched output fails the verdict", () => { expect(verdict({ ...good, output: { match: false } }, 0, true, true)).toBe("no"); });
  it("current build is 'current'", () => { expect(verdict(good, 0, true, true)).toBe("current"); });
  it.each([1, 2, 5])("superseded build %i is 'previous', never 'current'", (i) => { expect(verdict(good, i, true, true)).toBe("previous"); });
  it("unknown build is 'no'", () => { expect(verdict({ ...good, published: false }, -1, true, true)).toBe("no"); });
  it.each([["dcap", false, true], ["pcs", true, false]])("%s failure is 'no'", (_n, d, p) => { expect(verdict(good, 0, d as boolean, p as boolean)).toBe("no"); });
  it.each(["quote", "registered", "published"] as const)("%s false is 'no'", (k) => { expect(verdict({ ...good, [k]: false }, 0, true, true)).toBe("no"); });
  it("fastfs pending or failed is 'no'", () => { for (const f of [null, false]) expect(verdict({ ...good, fastfs: f }, 0, true, true)).toBe("no"); });
  it("binding missing is 'no'", () => { expect(verdict({ ...good, binding: null }, 0, true, true)).toBe("no"); });
});

describe("audit: publish tx matches the current hash", () => {
  it("README pairs WORKER_PUBLISH_TX with WORKER_WASM_SHA256[0]", () => {
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    const line = readme.split("\n").find((l) => l.includes(WORKER_PUBLISH_TX.slice(0, 8)) && l.includes(WORKER_WASM_SHA256[0].slice(0, 8)));
    expect(line, "a README line names both").toBeTruthy();
  });
  it("is not the 452df1fd add_version", () => { expect(WORKER_PUBLISH_TX.startsWith("FXbXhGNi")).toBe(false); });
});

describe("audit: gateway hardening", () => {
  it.each(["/attestations/by-call/2896d0ad-aa27-4e21-b4a1-0cf2d3755d56"])("accepts %s", (p) => { expect(safeAttPath(p)).toBe(true); });
  it.each(["@evil.example/x", "//evil.example/attestations/by-call/2896d0ad-aa27-4e21-b4a1-0cf2d3755d56", "/attestations/by-call/../x", "", null, 5, "/attestations/by-call/2896d0ad-aa27-4e21-b4a1-0cf2d3755d56?x"])("rejects %s", (p) => { expect(safeAttPath(p)).toBe(false); });
  const H = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
  it("prefers x-real-ip", () => { expect(clientIp(H({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9, 1.1.1.1" }))).toBe("1.1.1.1"); });
  it("falls back to first forwarded hop, then anon", () => { expect(clientIp(H({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" }))).toBe("2.2.2.2"); expect(clientIp(H({}))).toBe("anon"); });
  it("limiter keeps a live window when the map overflows", () => {
    const lim = createLimiter(1, 60_000);
    expect(lim("victim", 0).ok).toBe(true);
    for (let i = 0; i < 5001; i++) lim(`k${i}`, 1);
    expect(lim("victim", 2).ok).toBe(false);
  });
  it("limiter refuses a new key when full of live windows", () => {
    const lim = createLimiter(5, 60_000);
    for (let i = 0; i < 5000; i++) lim(`k${i}`, 0);
    expect(lim("new", 1).ok).toBe(false);
  });
  it("limiter frees expired keys to admit a new one", () => {
    const lim = createLimiter(5, 10);
    for (let i = 0; i < 5000; i++) lim(`k${i}`, 0);
    expect(lim("new", 20).ok).toBe(true);
  });
  it.each(["mint_quota", "busy", "quote_moved", "chainsig_quota"])("%s is a known code with copy", (c) => {
    expect(isKnownCode(c)).toBe(true);
    expect((en as { errors: Record<string, unknown> }).errors[c]).toBeTruthy();
  });
  it("every known code has copy", () => { for (const c of WORKER_ERROR_CODES) expect((en as { errors: Record<string, unknown> }).errors[c], c).toBeTruthy(); });
});
