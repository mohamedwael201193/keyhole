import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENT_PAGE_SIZE } from "@/lib/chainEvents";
import { readKeyHistory } from "@/lib/keyEventRead";

const CONTRACT = "keyhole-devmo.near";
const TOKEN = "k5f4750858f328940";
const TX = "BbTs3JZaxdrgwPu6SjZQwjpuXk7wAxizeVqzKrS2pxNp";
const sale = `EVENT_JSON:${JSON.stringify({ standard: "keyhole", version: "1.0.0", event: "key_sale", data: [{ token_id: TOKEN, seller: "a.near", buyer: "b.near", price: "1", royalty: "0" }] })}`;

function receipt(method: string, token: string | null, hash = TX) {
  return {
    transaction_hash: hash,
    predecessor_account_id: "buyer.near",
    block_timestamp: "1794182936741174679",
    actions: [{ args: token ? JSON.stringify({ token_id: token }) : "{}" }],
    method,
  };
}

function rpc(outcomes: unknown[], error?: unknown) {
  if (error) return { error };
  return { result: { final_execution_status: "FINAL", receipts_outcome: outcomes } };
}

afterEach(() => vi.unstubAllGlobals());

describe("readKeyHistory", () => {
  it("does not cache a story: an archival error is unavailable, and a second call asks again", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      calls += 1;
      if (String(url).includes("method=nft_buy")) return Response.json({ txns: [receipt("nft_buy", TOKEN)], cursor: null });
      if (String(url).includes("/receipts?")) return Response.json({ txns: [], cursor: null });
      return Response.json(rpc([], { message: "down" }));
    }) as unknown as typeof fetch;
    const first = await readKeyHistory({ tokenId: TOKEN, contractId: CONTRACT, fetch: fetchImpl });
    const n = calls;
    const second = await readKeyHistory({ tokenId: TOKEN, contractId: CONTRACT, fetch: fetchImpl });
    expect(first.unavailable).toBe(true);
    expect(first.complete).toBe(false);
    expect(first.events).toEqual([]);
    expect(second.unavailable).toBe(true);
    expect(calls).toBeGreaterThan(n);
  });

  it("does not call an empty object a complete history", async () => {
    const fetchImpl = vi.fn(async () => Response.json({})) as unknown as typeof fetch;
    const read = await readKeyHistory({ tokenId: TOKEN, contractId: CONTRACT, fetch: fetchImpl });
    expect(read.unavailable).toBe(true);
    expect(read.complete).toBe(false);
    expect(read.events).toEqual([]);
  });

  it("keeps a loan_closed event from the policy callback", async () => {
    const closed = `EVENT_JSON:${JSON.stringify({ standard: "keyhole", version: "1.0.0", event: "loan_closed", data: [{ token_id: TOKEN, nonce: "4", resolution: "repaid" }] })}`;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Response.json(rpc([{ outcome: { executor_id: CONTRACT, status: { SuccessValue: "" }, logs: [closed] } }]));
      if (String(url).includes("method=on_loan_policy")) return Response.json({ txns: [receipt("on_loan_policy", TOKEN, "closetx")], cursor: null });
      return Response.json({ txns: [], cursor: null });
    }) as unknown as typeof fetch;
    const read = await readKeyHistory({ tokenId: TOKEN, contractId: CONTRACT, fetch: fetchImpl });
    expect(read.unavailable).toBe(false);
    expect(read.complete).toBe(true);
    expect(read.events.map((e) => e.event)).toEqual(["loan_closed"]);
  });

  it("treats archival HTTP 503 as unavailable", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response("down", { status: 503 });
      if (String(url).includes("method=nft_buy")) return Response.json({ txns: [receipt("nft_buy", TOKEN)] });
      return Response.json({ txns: [] });
    }) as unknown as typeof fetch;
    const read = await readKeyHistory({ tokenId: TOKEN, contractId: CONTRACT, fetch: fetchImpl });
    expect(read.unavailable).toBe(true);
    expect(read.events).toEqual([]);
  });

  it("reads the target on page two and a principal delivery with no token argument", async () => {
    const filler = Array.from({ length: EVENT_PAGE_SIZE }, (_, i) => receipt("nft_buy", "kother", `H${i}`.padEnd(44, "a")));
    const delivered = `EVENT_JSON:${JSON.stringify({ standard: "keyhole", version: "1.0.0", event: "loan_principal_delivered", data: [{ token_id: TOKEN, nonce: "2", payout_nonce: "9" }] })}`;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { params: string[] };
        const hash = body.params[0];
        const logs = hash === TX ? [sale] : hash === "claimtx" ? [delivered] : [];
        const executor = hash.startsWith("H") ? CONTRACT : CONTRACT;
        return Response.json(rpc([{ outcome: { executor_id: executor, status: { SuccessValue: "" }, logs } }]));
      }
      if (u.includes("method=nft_buy") && !u.includes("cursor=")) return Response.json({ txns: filler, cursor: "page2" });
      if (u.includes("method=nft_buy") && u.includes("cursor=page2")) return Response.json({ txns: [receipt("nft_buy", TOKEN, TX)], cursor: null });
      if (u.includes("method=claim_payout")) return Response.json({ txns: [{ transaction_hash: "claimtx", predecessor_account_id: "borrower.near", block_timestamp: "1794182936741174679", actions: [{ args: "{}" }] }] });
      return Response.json({ txns: [] });
    }) as unknown as typeof fetch;
    const read = await readKeyHistory({ tokenId: TOKEN, contractId: CONTRACT, fetch: fetchImpl });
    expect(read.unavailable).toBe(false);
    expect(read.complete).toBe(true);
    expect(read.events.map((e) => e.event).sort()).toEqual(["key_sale", "loan_principal_delivered"]);
  });

  it("does not treat unreadable action args as a complete empty history", async () => {
    const hash = "H".padEnd(44, "a");
    const row = (actions: unknown[]) => ({ transaction_hash: hash, predecessor_account_id: "buyer.near", actions });
    const bodies = [
      { txns: [row([{}])], cursor: null },
      { txns: [row([{ args: 42 }])], cursor: null },
      { txns: [row([{ args: "not-json-or-base64" }])], cursor: null },
      { txns: [row([{ args: Buffer.from("nope").toString("base64") }])], cursor: null },
    ];
    for (const body of bodies) {
      let posts = 0;
      const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") { posts += 1; return Response.json({ result: {} }); }
        if (String(url).includes("method=nft_buy")) return Response.json(body);
        return Response.json({ txns: [], cursor: null });
      }) as unknown as typeof fetch;
      const read = await readKeyHistory({ tokenId: TOKEN, contractId: CONTRACT, fetch: fetchImpl });
      expect(read.unavailable).toBe(true);
      expect(read.complete).toBe(false);
      expect(read.events).toEqual([]);
      expect(posts).toBe(0);
    }
  });

  it("keeps a readable other key as a complete empty history", async () => {
    const other = Buffer.from(JSON.stringify({ token_id: "kother" })).toString("base64");
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("method=nft_buy")) {
        return Response.json({ txns: [{ transaction_hash: TX, predecessor_account_id: "buyer.near", actions: [{ args: other }] }], cursor: null });
      }
      return Response.json({ txns: [], cursor: null });
    }) as unknown as typeof fetch;
    const read = await readKeyHistory({ tokenId: TOKEN, contractId: CONTRACT, fetch: fetchImpl });
    expect(read.unavailable).toBe(false);
    expect(read.complete).toBe(true);
    expect(read.events).toEqual([]);
  });

  it("does not treat a malformed receipt row as a complete empty history", async () => {
    for (const body of [{ txns: [{}], cursor: null }, { txns: [{ transaction_hash: 42, actions: [] }], cursor: null }]) {
      const fetchImpl = vi.fn(async () => Response.json(body)) as unknown as typeof fetch;
      const read = await readKeyHistory({ tokenId: TOKEN, contractId: CONTRACT, fetch: fetchImpl });
      expect(read.unavailable).toBe(true);
      expect(read.complete).toBe(false);
      expect(read.events).toEqual([]);
    }
  });
});
