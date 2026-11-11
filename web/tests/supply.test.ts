import { afterEach, describe, expect, it, vi } from "vitest";
import { holderSupply, readHolderSupply } from "@/lib/supply";

function rpc(value: string, blockHash: string) {
  return { result: { result: Array.from(Buffer.from(JSON.stringify(value))), block_hash: blockHash, block_height: 1 } };
}

describe("holderSupply", () => {
  it("keeps the home count at minted minus the contract-held test key", () => {
    expect(holderSupply("6", "1")).toEqual({ supply: 5, minted: 6, excluded_test_keys: 1, block_hash: "" });
  });
  it("accepts zero and refuses a negative, a gap, and an unsafe integer", () => {
    expect(holderSupply("0", "0")).toEqual({ supply: 0, minted: 0, excluded_test_keys: 0, block_hash: "" });
    expect(holderSupply("1", "2")).toBeNull();
    expect(holderSupply("-1", "0")).toBeNull();
    expect(holderSupply(String(Number.MAX_SAFE_INTEGER + 1), "0")).toBeNull();
    expect(holderSupply("nope", "0")).toBeNull();
  });
});

describe("readHolderSupply", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pins minted and excluded to one block hash", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { params: { method_name: string; block_id?: string; finality?: string } };
      bodies.push(body.params);
      if (!body.params.block_id) return Response.json(rpc("6", "block100"));
      if (body.params.method_name === "nft_total_supply") return Response.json(rpc("6", body.params.block_id));
      return Response.json(rpc("1", body.params.block_id));
    }));
    const snap = await readHolderSupply();
    expect(snap).toEqual({ supply: 5, minted: 6, excluded_test_keys: 1, block_hash: "block100" });
    const pinned = bodies.filter((p) => (p as { block_id?: string }).block_id);
    expect(pinned).toHaveLength(2);
    expect(pinned.every((p) => (p as { block_id: string }).block_id === "block100" && !("finality" in (p as object)))).toBe(true);
  });

  it("returns null when the two reads do not share a block", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { params: { method_name: string; block_id?: string } };
      if (!body.params.block_id) return Response.json(rpc("6", "block100"));
      if (body.params.method_name === "nft_total_supply") return Response.json(rpc("6", "block100"));
      return Response.json(rpc("0", "block101"));
    }));
    expect(await readHolderSupply()).toBeNull();
  });
});
