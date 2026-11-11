import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/key-events/route";
import { chainEventView, EVENT_PAGE_SIZE } from "@/lib/chainEvents";
import { KEYS_CONTRACT } from "@/lib/config";

const TOKEN = "k5f4750858f328940";
afterEach(() => vi.unstubAllGlobals());

function req() {
  return new Request(`http://localhost/api/key-events?id=${TOKEN}`, { headers: { "x-forwarded-for": "192.0.2.40" } });
}

describe("GET /api/key-events", () => {
  it.each([
    { txns: [{}], cursor: null },
    { txns: [{ transaction_hash: 42, actions: [] }], cursor: null },
  ])("a malformed receipt row is unavailable, not a complete empty history", async (body) => {
    const fetchImpl = vi.fn(async () => Response.json(body));
    vi.stubGlobal("fetch", fetchImpl);
    const res = await GET(req());
    const j = await res.json();
    expect(j.ok).toBe(false);
    expect(j.complete).toBe(false);
    expect(j.unavailable).toBe(true);
    expect(j.events).toEqual([]);
    expect(j.error.code).toBe("unavailable");
    const calls = fetchImpl.mock.calls.length;
    const again = await GET(req());
    const second = await again.json();
    expect(second.unavailable).toBe(true);
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(calls);
  });

  it.each([
    [{}],
    [{ args: 42 }],
    [{ args: "not-json-or-base64" }],
  ])("unreadable action args are not cached as a complete empty history", async (action) => {
    const row = { transaction_hash: "H".padEnd(44, "b"), predecessor_account_id: "buyer.near", actions: [action] };
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Response.json({ result: { final_execution_status: "FINAL" } });
      if (String(url).includes("method=nft_buy")) return Response.json({ txns: [row], cursor: null });
      return Response.json({ txns: [], cursor: null });
    });
    vi.stubGlobal("fetch", fetchImpl);
    const first = await (await GET(req())).json();
    expect(first).toMatchObject({ ok: false, complete: false, unavailable: true, events: [] });
    expect(fetchImpl.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === "POST")).toBe(false);
    const calls = fetchImpl.mock.calls.length;
    const second = await (await GET(req())).json();
    expect(second).toMatchObject({ ok: false, complete: false, unavailable: true, events: [] });
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(calls);
  });

  it("keeps a transfer unlist and a collateral callback, and the cached repeat still has them", async () => {
    const token = "kxferunlist1";
    const log = (event: string, data: Record<string, unknown>) =>
      `EVENT_JSON:${JSON.stringify({ standard: "keyhole", version: "1.0.0", event, data: [data] })}`;
    const row = (hash: string, args: unknown, predecessor = "alice.near") => ({
      transaction_hash: hash,
      predecessor_account_id: predecessor,
      block_timestamp: "1794182936741174679",
      actions: [{ args }],
    });
    const seeds: Record<string, unknown[]> = {
      nft_list: [row("listtx", { token_id: token, price: "100000000000000000000000" })],
      nft_transfer: [row("transfertx", { receiver_id: "bob.near", token_id: token })],
      nft_transfer_call: [row("calltx", { receiver_id: "carol.near", token_id: token, msg: "" })],
      nft_transfer_payout: [row("payouttx", { receiver_id: "dave.near", token_id: token, balance: "1" })],
      on_collateral_checked: [row("colltx", { token_id: token, nonce: "1" }, KEYS_CONTRACT)],
    };
    const logs: Record<string, string[]> = {
      listtx: [log("key_list", { token_id: token, seller: "alice.near", price: "100000000000000000000000" })],
      transfertx: [log("key_unlist", { token_id: token, seller: "transfer.near" })],
      calltx: [log("key_unlist", { token_id: token, seller: "call.near" })],
      payouttx: [log("key_unlist", { token_id: token, seller: "payout.near" })],
      colltx: [log("collateral_ready", { token_id: token, wallet_pubkey: "ed25519:ab" })],
    };
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const hash = (JSON.parse(String(init.body)) as { params: string[] }).params[0];
        return Response.json({
          result: {
            final_execution_status: "FINAL",
            receipts_outcome: [{ outcome: { executor_id: KEYS_CONTRACT, status: { SuccessValue: "" }, logs: logs[hash] ?? [] } }],
          },
        });
      }
      if (String(url).includes("/v1/txns/")) return Response.json({ txns: [{ signer_account_id: "minter.near" }] });
      const method = new URL(String(url)).searchParams.get("method") ?? "";
      return Response.json({ txns: seeds[method] ?? [], cursor: null });
    });
    vi.stubGlobal("fetch", fetchImpl);
    const ask = () => GET(new Request(`http://localhost/api/key-events?id=${token}`, { headers: { "x-forwarded-for": "192.0.2.51" } }));
    const first = await (await ask()).json();
    const view = chainEventView(first);
    expect(first).toMatchObject({ ok: true, complete: true, unavailable: false });
    expect(view.state).toBe("ready");
    expect(first.events.map((e: { event: string }) => e.event).sort()).toEqual(["collateral_ready", "key_list", "key_unlist", "key_unlist", "key_unlist"]);
    expect(first.events.filter((e: { event: string }) => e.event === "key_unlist").map((e: { data: { seller: string } }) => e.data.seller).sort()).toEqual(["call.near", "payout.near", "transfer.near"]);
    const queried = fetchImpl.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("/receipts?")).map((url) => new URL(url).searchParams.get("method"));
    expect(queried).toEqual(expect.arrayContaining(["nft_transfer", "nft_transfer_call", "nft_transfer_payout", "register_collateral", "check_collateral", "on_collateral_checked"]));
    const calls = fetchImpl.mock.calls.length;
    const second = await (await ask()).json();
    expect(second.events).toEqual(first.events);
    expect(second.complete).toBe(true);
    expect(fetchImpl.mock.calls.length).toBe(calls);
  });

  it("does not cache a truncated transfer scan as a complete history", async () => {
    const token = "ktruncxfer01";
    const filler = Array.from({ length: EVENT_PAGE_SIZE }, (_, i) => ({
      transaction_hash: `H${i}`.padEnd(44, "a"),
      predecessor_account_id: "alice.near",
      actions: [{ args: { token_id: "kother" } }],
    }));
    const listed = {
      transaction_hash: "listtx",
      predecessor_account_id: "alice.near",
      block_timestamp: "1794182936741174679",
      actions: [{ args: { token_id: token } }],
    };
    const sale = `EVENT_JSON:${JSON.stringify({ standard: "keyhole", version: "1.0.0", event: "key_list", data: [{ token_id: token, seller: "alice.near", price: "1" }] })}`;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Response.json({
          result: {
            final_execution_status: "FINAL",
            receipts_outcome: [{ outcome: { executor_id: KEYS_CONTRACT, status: { SuccessValue: "" }, logs: [sale] } }],
          },
        });
      }
      const method = new URL(String(url)).searchParams.get("method");
      if (method === "nft_transfer") return Response.json({ txns: filler, cursor: "more" });
      if (method === "nft_list") return Response.json({ txns: [listed], cursor: null });
      return Response.json({ txns: [], cursor: null });
    });
    vi.stubGlobal("fetch", fetchImpl);
    const ask = () => GET(new Request(`http://localhost/api/key-events?id=${token}`, { headers: { "x-forwarded-for": "192.0.2.52" } }));
    const first = await (await ask()).json();
    expect(first).toMatchObject({ ok: false, complete: false, unavailable: true });
    expect(first.events.map((e: { event: string }) => e.event)).toEqual(["key_list"]);
    expect(chainEventView(first).state).toBe("partial");
    const calls = fetchImpl.mock.calls.length;
    const second = await (await ask()).json();
    expect(second.complete).toBe(false);
    expect(second.unavailable).toBe(true);
    expect(chainEventView(second).state).not.toBe("ready");
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(calls);
  });
});
