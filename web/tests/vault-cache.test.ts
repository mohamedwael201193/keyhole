import { describe, expect, it } from "vitest";
import { clearVaultCache, vaultCacheFresh, vaultCacheGet, vaultCacheInvalidate, vaultCacheKey, vaultCacheSet, VAULT_CACHE_TTL_MS } from "@/lib/vaultCache";
import type { WorkerResult } from "@/lib/worker";

/** An in-memory stand-in for sessionStorage (vitest runs in node, where there is none). */
function fakeStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
  };
}

const res = (call_id: string): WorkerResult => ({ call_id, status: "ok", output: { ok: true }, attestation_url: null, time_ms: 1 });

describe("vaultCacheKey", () => {
  it("scopes a read by account, session and op, and refuses a key without a session", () => {
    expect(vaultCacheKey("alice.near", "tok-1", "balance")).toBe("kh_vault_v1:alice.near:tok-1:balance");
    expect(vaultCacheKey("alice.near", null, "balance")).toBeNull();
    expect(vaultCacheKey(null, "tok-1", "balance")).toBeNull();
    expect(vaultCacheKey("alice.near", "tok-1", "balance")).not.toBe(vaultCacheKey("alice.near", "tok-2", "balance"));
    expect(vaultCacheKey("alice.near", "tok-1", "balance")).not.toBe(vaultCacheKey("bob.near", "tok-1", "balance"));
  });
});

describe("vaultCacheFresh", () => {
  it("is fresh inside the TTL and stale at it", () => {
    const now = 1_000_000;
    expect(vaultCacheFresh(now - 1, now)).toBe(true);
    expect(vaultCacheFresh(now - VAULT_CACHE_TTL_MS, now)).toBe(false);
    expect(vaultCacheFresh(now - VAULT_CACHE_TTL_MS - 1, now)).toBe(false);
  });
});

describe("vaultCacheGet / vaultCacheSet", () => {
  it("serves a stored read from memory, and a fresh one from the store after the memory is gone", () => {
    const store = fakeStore();
    const key = vaultCacheKey("cache-a.near", "tok-a", "balance")!;
    expect(vaultCacheGet(key, Date.now(), store)).toBeNull();
    vaultCacheSet(key, res("call-a"), store);
    expect(vaultCacheGet(key, Date.now(), store)?.call_id).toBe("call-a");
    expect(store.getItem(key)).toContain("call-a");
  });

  it("drops a stale entry instead of serving it", () => {
    const store = fakeStore();
    const key = vaultCacheKey("cache-b.near", "tok-b", "history")!;
    vaultCacheSet(key, res("call-b"), store);
    const later = Date.now() + VAULT_CACHE_TTL_MS + 1_000;
    expect(vaultCacheGet(key, later, store)).toBeNull();
    expect(store.getItem(key)).toBeNull();
  });

  it("ignores a corrupt stored entry", () => {
    const store = fakeStore();
    const key = vaultCacheKey("cache-c.near", "tok-c", "balance")!;
    store.setItem(key, "{not json");
    expect(vaultCacheGet(key, Date.now(), store)).toBeNull();
  });
});

describe("vaultCacheInvalidate", () => {
  it("drops one op for one account and leaves the rest", () => {
    const store = fakeStore();
    const bal = vaultCacheKey("inv-a.near", "tok-a", "balance")!;
    const his = vaultCacheKey("inv-a.near", "tok-a", "history")!;
    const other = vaultCacheKey("inv-b.near", "tok-b", "balance")!;
    vaultCacheSet(bal, res("c1"), store);
    vaultCacheSet(his, res("c2"), store);
    vaultCacheSet(other, res("c3"), store);
    vaultCacheInvalidate("inv-a.near", "balance", store);
    expect(vaultCacheGet(bal, Date.now(), store)).toBeNull();
    expect(vaultCacheGet(his, Date.now(), store)?.call_id).toBe("c2");
    expect(vaultCacheGet(other, Date.now(), store)?.call_id).toBe("c3");
    vaultCacheInvalidate("inv-a.near", undefined, store);
    expect(vaultCacheGet(his, Date.now(), store)).toBeNull();
    expect(vaultCacheGet(other, Date.now(), store)?.call_id).toBe("c3");
  });

  it("clearVaultCache drops everything", () => {
    const store = fakeStore();
    const key = vaultCacheKey("inv-c.near", "tok-c", "dashboard")!;
    vaultCacheSet(key, res("c9"), store);
    clearVaultCache(store);
    expect(vaultCacheGet(key, Date.now(), store)).toBeNull();
    expect(store.length).toBe(0);
  });
});
