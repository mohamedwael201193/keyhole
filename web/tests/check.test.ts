import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/check/route";
import { checkCounterparty, isNearAccountId, score, type Signals } from "@/lib/counterparty";
import blocklistFile from "@/lib/blocklist.json";

const req = (qs: string, ip = "203.0.113.7") => new Request(`https://example.test/api/check${qs}`, { headers: { "x-real-ip": ip } });

describe("GET /api/check", () => {
  it("refuses a missing or malformed account with 400 and makes no lookup", async () => {
    for (const qs of ["", "?account=", "?account=Not%20A%20NEAR%20ID", "?account=ok.near&agent=BAD%21"]) {
      const r = await GET(req(qs));
      expect(r.status).toBe(400);
      expect(await r.json()).toMatchObject({ ok: false, error: { code: "bad_params" } });
    }
  });

  it("returns BLOCK for a blocklisted receiver from the shipped list, with no network call", async () => {
    const r = await GET(req("?account=keyhole-demo-blocked.near", "203.0.113.10"));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const body = await r.json();
    expect(body).toMatchObject({ ok: true, verdict: "block", signals: { listed: { account: "keyhole-demo-blocked.near" } } });
    expect(body.reasons[0]).toMatch(/^blocklist: /);
    expect(JSON.stringify(body)).not.toMatch(/secret|api[_-]?key|authorization/i);
  });

  it("rate-limits per client after 30 calls a minute", async () => {
    const ip = "203.0.113.99";
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await GET(req("?account=keyhole-demo-blocked.near", ip))).status;
    expect(last).toBe(429);
  });
});

describe("counterparty module on the web", () => {
  it("shares the CLI rules: a blocklisted receiver blocks without a network call", async () => {
    let calls = 0;
    const f = (async () => { calls++; throw new Error("no network in tests"); }) as typeof fetch;
    const r = await checkCounterparty("keyhole-demo-blocked.near", { blocklist: blocklistFile.entries, fetch: f });
    expect(r.verdict).toBe("block");
    expect(calls).toBe(0);
  });

  it("an unreachable chain is WARN, never ALLOW", async () => {
    const f = (async () => { throw new Error("offline"); }) as typeof fetch;
    const r = await checkCounterparty("someone.near", { blocklist: [], agent: null, fetch: f, timeoutMs: 100 });
    expect(r.verdict).toBe("warn");
    expect(r.reasons).toContain("signal unavailable: exists");
  });

  it("scoring and account-id checks behave as documented", () => {
    const signals: Signals = { receiver: "x.near", agent: "a.near", foreign: false, invalid: false, listed: null, allowlisted: false, exists: true, is_contract: false,
      code_hash_now: null, code_changed_24h: null, code_changed_7d: null, account_age_days: 400, txns_30d: 9, prior_interactions: 2, block_height: null, unavailable: [] };
    expect(score(signals).verdict).toBe("allow");
    expect(isNearAccountId("keyhole-devmo.near")).toBe(true);
    expect(isNearAccountId("UPPER.near")).toBe(false);
  });
});
