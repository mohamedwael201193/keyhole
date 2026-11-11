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
});
