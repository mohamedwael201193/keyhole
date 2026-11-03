import { describe, expect, it } from "vitest";
import { pairCheck, readPair } from "@/lib/pairCheck";

const ok = { block: 100, tokenOwner: "a.near", ownerTokens: ["k1"], holderTier: 1 };
describe("pair check (off-chain consistency)", () => {
  it("consistent pair on one block passes", () => { expect(pairCheck("k1", ok, [100, 100, 100]).ok).toBe(true); });
  it.each([[[100, 101, 100]], [[99]], [[]]])("reads on different blocks fail: %j", (b) => { expect(pairCheck("k1", ok, b as number[]).reasons).toContain("reads not pinned to one block"); });
  it("missing token fails", () => { expect(pairCheck("k1", { ...ok, tokenOwner: null }, [100]).ok).toBe(false); });
  it("owner list without the token fails", () => { expect(pairCheck("k1", { ...ok, ownerTokens: ["k2"] }, [100]).reasons).toContain("owner's token list does not include the token"); });
  it("owner without tier fails", () => { expect(pairCheck("k1", { ...ok, holderTier: null }, [100]).ok).toBe(false); });
  it("readPair pins every view to the final block height", async () => {
    const seen: (number | string)[] = [];
    const f = (async (_u: string, init: { body: string }) => {
      const q = JSON.parse(init.body);
      if (q.method === "block") return { json: async () => ({ result: { header: { height: 777 } } }) };
      seen.push(q.params.block_id);
      const v = q.params.method_name === "nft_token" ? { owner_id: "a.near" } : q.params.method_name === "holder_tier" ? 1 : [{ token_id: "k1" }];
      return { json: async () => ({ result: { block_height: q.params.block_id, result: [...Buffer.from(JSON.stringify(v))] } }) };
    }) as unknown as typeof fetch;
    const { read, blocks } = await readPair("c.near", "k1", f);
    expect(seen).toEqual([777, 777, 777]);
    expect(pairCheck("k1", read, blocks).ok).toBe(true);
  });
});
