import { describe, expect, it } from "vitest";
import { countOpenLoans, distinctHolders, newestKeyEvent, readMainnetStats, unavailableStats, clearStatsCache } from "@/lib/mainnetStats";

const HASH = "89vSYY4tbeNPuNuhHB8YmkkAWAcjW5VdniQm3ePHuPYz";
const OLDER = "DRDtKjYuPJzF3ESGe7Lihtx3tRv7YqN4u5reiYjvGSq4";

function rpc(value: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", result: { result: Array.from(Buffer.from(JSON.stringify(value))) } }), { status: 200 });
}

describe("mainnet stat reducers", () => {
  it("counts distinct holders and open loans, and keeps a failed loan read unavailable", () => {
    expect(distinctHolders([{ owner_id: "a.near" }, { owner_id: "b.near" }, { owner_id: "a.near" }])).toBe(2);
    expect(distinctHolders([{ owner_id: "a.near" }, {}])).toBeNull();
    expect(countOpenLoans([null, { state: "Active" }, null])).toBe(1);
    expect(countOpenLoans([null, undefined])).toBeNull();
  });

  it("picks the newest successful key event and ignores failures", () => {
    const ok = { receiver_account_id: "keyhole-devmo.near", outcomes: { status: true } };
    const event = newestKeyEvent([
      { ...ok, transaction_hash: OLDER, block_timestamp: "1000", actions: [{ method: "nft_mint" }] },
      { ...ok, transaction_hash: HASH, block_timestamp: "2000", actions: [{ method: "nft_transfer" }] },
      { ...ok, outcomes: { status: false }, transaction_hash: "5Zkuiy3W62pyYwQ8k3mN7pR4sT6uV8wX0yZ2aB4cD6e", block_timestamp: "3000", actions: [{ method: "nft_mint" }] },
    ]);
    expect(event).toMatchObject({ hash: HASH, method: "nft_transfer" });
    expect(newestKeyEvent([{ transaction_hash: HASH, outcomes: { status: true }, actions: [{ action: "TRANSFER" }] }])).toBeNull();
  });
});

describe("live read cache", () => {
  it("serves a fresh success, then unavailable after the window when the RPC fails", async () => {
    clearStatsCache();
    let calls = 0;
    let fail = false;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls += 1;
      if (fail) throw new Error("rpc down");
      const body = init?.body ? JSON.parse(String(init.body)) as { params?: { method_name?: string; args_base64?: string } } : null;
      const method = body?.params?.method_name;
      if (method === "nft_total_supply") return rpc("2");
      if (method === "nft_tokens") return rpc([{ token_id: "k1", owner_id: "a.near" }, { token_id: "k2", owner_id: "b.near" }]);
      if (method === "get_loan") {
        const args = JSON.parse(Buffer.from(body?.params?.args_base64 ?? "", "base64").toString("utf8")) as { token_id?: string };
        return rpc(args.token_id === "k2" ? { state: "Active" } : null);
      }
      if (String(url).includes("/v3/accounts/")) {
        return new Response(JSON.stringify({ data: [{ transaction_hash: HASH, block_timestamp: "1794078245331137656", receiver_account_id: "keyhole-devmo.near", outcomes: { status: true }, actions: [{ method: "nft_transfer" }] }] }));
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;

    const first = await readMainnetStats({ now: 1_000, ttlMs: 1_000, cacheKey: "t1", fetchImpl });
    expect(first.live).toBe(true);
    expect(first.totalKeys).toEqual({ ok: true, value: 2 });
    expect(first.holders).toEqual({ ok: true, value: 2 });
    expect(first.activeLiens).toEqual({ ok: true, value: 1 });
    expect(first.latestEvent.ok).toBe(true);
    const used = calls;
    const cached = await readMainnetStats({ now: 1_500, ttlMs: 1_000, cacheKey: "t1", fetchImpl });
    expect(cached.totalKeys.value).toBe(2);
    expect(calls).toBe(used);
    fail = true;
    const failed = await readMainnetStats({ now: 3_000, ttlMs: 1_000, cacheKey: "t1", fetchImpl });
    expect(failed).toEqual(unavailableStats());
    expect(failed.totalKeys.value).toBeNull();
    expect(failed.live).toBe(false);
  });

  it("an RPC failure does not invent a zero", async () => {
    clearStatsCache();
    const fetchImpl = (async () => { throw new Error("down"); }) as typeof fetch;
    const stats = await readMainnetStats({ now: 1, ttlMs: 1, cacheKey: "t2", fetchImpl });
    expect(stats.live).toBe(false);
    expect(stats.totalKeys).toEqual({ ok: false, value: null });
    expect(stats.holders.value).toBeNull();
    expect(stats.activeLiens.value).toBeNull();
    expect(stats.latestEvent.value).toBeNull();
  });
});
