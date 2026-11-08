import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AccountCache, KEYS_CACHE_MS, KEYS_RPC_TIMEOUT_MS, validAccountId } from "@/lib/keysApi";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("/api/keys account validation", () => {
  it("accepts named accounts and 64-hex implicit accounts", () => {
    for (const id of ["holder.near", "keyhole-devmo.near", "a1.b-c_d.testnet", "ab", "dao.sub.account.near", "a".repeat(64), "f".repeat(64)]) {
      expect(validAccountId(id), id).toBe(true);
    }
  });
  it("refuses anything that is not an account id, before any RPC call", () => {
    for (const id of [null, undefined, "", "a", "A.near", "holder..near", ".near", "-a.near", "a-.near", "a b.near", "../etc", "http://x.near", "holder.near?x=1", "a".repeat(65), "F".repeat(64), "a".repeat(63) + "_", 123, { id: "holder.near" }]) {
      expect(validAccountId(id), String(id)).toBe(false);
    }
  });
});

describe("/api/keys server cache", () => {
  it("answers from memory inside 15 seconds and expires after", () => {
    expect(KEYS_CACHE_MS).toBe(15_000);
    const c = new AccountCache<string>(KEYS_CACHE_MS);
    c.set("holder.near", "keys", 1_000);
    expect(c.get("holder.near", 1_000 + KEYS_CACHE_MS - 1)).toBe("keys");
    expect(c.get("holder.near", 1_000 + KEYS_CACHE_MS)).toBeNull();
  });
  it("keeps one answer per account", () => {
    const c = new AccountCache<string>();
    c.set("a.near", "A", 0);
    expect(c.get("b.near", 0)).toBeNull();
    expect(c.get("a.near", 0)).toBe("A");
  });
  it("never holds more than its cap, dropping the oldest first", () => {
    const c = new AccountCache<number>(60_000, 2);
    c.set("a.near", 1, 0);
    c.set("b.near", 2, 0);
    c.set("c.near", 3, 0);
    expect(c.get("a.near", 0)).toBeNull();
    expect(c.get("b.near", 0)).toBe(2);
    expect(c.get("c.near", 0)).toBe(3);
  });
});

describe("/api/keys route and the key store", () => {
  const route = src("../app/api/keys/route.ts");
  it("validates the account first and answers 400 without one", () => {
    expect(route).toContain('searchParams.get("account")');
    expect(route).toContain("validAccountId(account)");
    expect(route).toContain("status: 400");
  });
  it("reads through the configured RPC list with a 4 s timeout per attempt, and never caches in the browser", () => {
    expect(KEYS_RPC_TIMEOUT_MS).toBe(4_000);
    expect(route).toContain("nearView<Token[]>(\"nft_tokens_for_owner\"");
    expect(route).toContain("\"nft_tier\"");
    expect(route).toContain("timeoutMs: KEYS_RPC_TIMEOUT_MS");
    expect(route).toContain('"cache-control": "no-store"');
    expect(src("../lib/rpc.ts")).toContain("for (const url of NEAR_RPCS)");
  });
  it("the key store calls the route first and falls back to the direct read", () => {
    const store = src("../lib/keyStore.tsx");
    expect(store).toContain("/api/keys?account=");
    expect(store.indexOf("/api/keys?account=")).toBeLessThan(store.indexOf("await tokensFor(accountId, KEY_LIST_LIMIT)"));
    expect(store).toContain("await readKeys(accountId)");
  });
});
