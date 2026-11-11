import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/key-events/route";

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
});
