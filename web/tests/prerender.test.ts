// Pages that read the chain must not be prerendered at build time (a slow RPC would fail the build).
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const pages = ["app/gallery/page.tsx", "app/identity/page.tsx"];
describe("chain-reading pages render per request", () => {
  it.each(pages)("%s is force-dynamic and not ISR", (p) => {
    const s = readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
    expect(s).toMatch(/export const dynamic = "force-dynamic"/);
    expect(s).not.toMatch(/export const revalidate/);
  });
});

// The landing is the exception: it is cached as a whole (ISR, 60 s) and its chain reads are shared, short and never throw.
describe("landing is ISR with a bounded read", () => {
  it("app/page.tsx revalidates every 60 s and is not force-dynamic", () => {
    const s = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
    expect(s).toMatch(/export const revalidate = 60;/);
    expect(s).not.toMatch(/force-dynamic/);
  });

  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  const rpcResult = (v: unknown) => ({ jsonrpc: "2.0", id: "kh", result: { result: Array.from(new TextEncoder().encode(JSON.stringify(v))) } });
  const tokens = [0, 1, 2, 3].map((i) => ({ token_id: `k${i}`, owner_id: "a.near", metadata: null }));
  const answers: Record<string, unknown> = { nft_total_supply: "10", nft_tokens: tokens, nft_tier: 1 };

  it("reads the total supply, 1 key page and one tier per shown key (6 calls, not 15)", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      const method = JSON.parse(init.body).params.method_name as string;
      calls.push(method);
      return new Response(JSON.stringify(rpcResult(answers[method])), { status: 200 });
    }));
    const { loadLanding } = await import("@/lib/landing");
    const data = await loadLanding();
    expect(calls.filter((m) => m === "nft_tier").length).toBe(4);
    expect(calls.length).toBe(6);
    expect(data.supply).toBe(10);
    expect(data.tokens.length).toBe(4);
    expect(data.tiers).toEqual([1, 1, 1, 1]);
  });

  it("an unreachable RPC gives the empty state and does not throw", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const { loadLanding } = await import("@/lib/landing");
    await expect(loadLanding()).resolves.toEqual({ supply: null, tokens: [], tiers: [] });
  });
});
