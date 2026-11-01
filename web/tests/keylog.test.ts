import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checkLog, holders, type KeyLogBody } from "@/lib/keylog";
import { TEE_MINTER } from "@/lib/config";
const body = (): KeyLogBody => JSON.parse(readFileSync(`${__dirname}/fixtures/keylog_k5f47.json`, "utf8"));
describe("key history", () => {
  it("re-verifies a real mainnet log: chain, head and minter signature", () => {
    const c = checkLog(body(), TEE_MINTER);
    expect(c).toEqual({ chain: true, head: true, sig: true, minter: true, badAt: null });
  });
  it("catches an edited event", () => {
    const b = body(); b.events[1].kind = "deposit";
    const c = checkLog(b, TEE_MINTER);
    expect(c.chain).toBe(false); expect(c.badAt).toBe(1); expect(c.head).toBe(false);
  });
  it("catches a dropped event", () => {
    const b = body(); b.events.splice(2, 1);
    expect(checkLog(b, TEE_MINTER).chain).toBe(false);
  });
  it("catches a forged head signature and a foreign signer", () => {
    const b = body(); b.sig = "00".repeat(64);
    expect(checkLog(b, TEE_MINTER).sig).toBe(false);
    expect(checkLog(body(), "ab".repeat(32)).minter).toBe(false);
  });
  it("splits holder periods", () => {
    const h = holders(body().events);
    expect(h.length).toBeGreaterThanOrEqual(3);
    expect(h[0].deposits).toBe(1);
    expect(h[h.length - 1].to_ms).toBeNull();
    for (let i = 1; i < h.length; i++) expect(h[i].owner).not.toBe(h[i - 1].owner);
  });
});
