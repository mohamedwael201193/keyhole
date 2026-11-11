import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { certificateCurrent, lienCacheKey, lienReadCurrent } from "@/lib/lienRead";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("lien cache identity", () => {
  const base = { contract: "keyhole-devmo.near", tokenId: "k5f4750858f328940", owner: "alice.near", marker: "0:1" };

  it("changes when the owner changes, including a sale that moves the key", () => {
    const before = lienCacheKey(base);
    expect(lienCacheKey({ ...base, owner: "bob.near" })).not.toBe(before);
    expect(lienCacheKey({ ...base, owner: null })).not.toBe(before);
  });

  it("changes on list, unlist, or a repeat lookup of the same key id", () => {
    const before = lienCacheKey(base);
    expect(lienCacheKey({ ...base, marker: "1:1" })).not.toBe(before);
    expect(lienCacheKey({ ...base, marker: "0:2" })).not.toBe(before);
    expect(lienCacheKey(base)).toBe(before);
  });

  it("drops a delayed read and a certificate for another key", () => {
    const started = { tokenId: "k-a", generation: 1 };
    expect(lienReadCurrent(started, { tokenId: "k-a", generation: 1 }, false)).toBe(true);
    expect(lienReadCurrent(started, { tokenId: "k-b", generation: 2 }, false)).toBe(false);
    expect(lienReadCurrent(started, { tokenId: "k-a", generation: 1 }, true)).toBe(false);
    expect(certificateCurrent(started, { tokenId: "k-a", generation: 1 }, false, "k-b")).toBe(false);
    expect(certificateCurrent(started, { tokenId: "k-a", generation: 1 }, false, "k-a")).toBe(true);
  });
});

describe("lien read wiring", () => {
  it("the hook keys the read, aborts it, and refuses another key's certificate", () => {
    const hook = src("../components/lien/useLien.ts");
    expect(hook).toContain("lienCacheKey(");
    expect(hook).toContain("new AbortController()");
    expect(hook).toContain("lienReadCurrent(");
    expect(hook).toContain('bundle.certificate.token_id !== token');
    expect(hook).toContain("requestLoanCertificate(token, loan.nonce, ctrl.signal)");
  });
  it("the key page passes owner and the sale round, and a repeat Open bumps the lookup", () => {
    const view = src("../app/key/view.tsx");
    expect(view).toContain("useLien(active || null, { owner: chain.owner ?? null, marker: `${saleRound}:${lookup}` })");
    expect(view).toContain("setLookup((n) => n + 1)");
    expect(view).toContain("setSaleRound((n) => n + 1)");
  });
  it("the same key id on /verify reads again", () => {
    const view = src("../app/verify/view.tsx");
    expect(view).toContain("useLien(tokenId, { marker: lookup })");
    expect(view).toContain("setLookup((n) => n + 1)");
  });
  it("the panel says the default is strictly after due + grace, and the certificate is a network call", () => {
    const panel = src("../components/lien/LienPanel.tsx");
    expect(panel).toContain("strictly after");
    expect(panel).toContain("no on-chain transaction");
    expect(panel).toContain("network call to the enclave");
  });
});
