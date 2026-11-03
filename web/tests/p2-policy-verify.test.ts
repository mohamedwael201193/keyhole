// P2: Agent API policy edge cases and /verify scoring matrix. Each row is a distinct input.
import { describe, expect, it } from "vitest";
import { buildPolicy, usdString, TIER_CAPS, USD6 } from "@/lib/agentPolicy";
import { attestChecks, verdict, safeAttPath, clientIp } from "@/lib/verifyScore";

describe("usdString rounds down to the cent", () => {
  it.each([[0, "0.00"], [9_999, "0.00"], [10_000, "0.01"], [999_999, "0.99"], [1_000_000, "1.00"], [1_009_999, "1.00"], [5_000_000, "5.00"], [123_456_789, "123.45"], [500_000_000, "500.00"]])("%i -> %s", (m, s) => { expect(usdString(m)).toBe(s); });
});

describe("buildPolicy: tier caps", () => {
  it.each([1, 2, 3] as const)("tier %i defaults to its caps", (t) => {
    const p = buildPolicy({ tier: t });
    for (const a of USD6) { expect(p.limits.per_transaction[a]).toBe(String(TIER_CAPS[t].per_tx_usd_micro)); expect(p.limits.daily[a]).toBe(String(TIER_CAPS[t].daily_usd_micro)); }
    expect(p.max_actions_per_hour).toBe(TIER_CAPS[t].per_minute_calls * 60);
    expect(p.budget.daily_usd).toBe(usdString(TIER_CAPS[t].daily_usd_micro));
  });
  it.each([0, 4, -1, 1.5, NaN, 99])("tier %s is refused", (t) => { expect(() => buildPolicy({ tier: t })).toThrow(); });
  it.each([[1, 2_000_000, 1_000_000], [1, 500_000, 500_000], [2, 10_000_000, 10_000_000], [2, 99_000_000, 10_000_000], [3, 1, 1]])("tier %i per_tx %i clamps to %i", (t, v, want) => {
    const p = buildPolicy({ tier: t, per_tx_usd_micro: v });
    expect(Object.values(p.limits.per_transaction)[0]).toBe(String(want));
  });
  it.each([0, -5, 1.5, Number.MAX_SAFE_INTEGER + 2, NaN])("per_tx %s is refused", (v) => { expect(() => buildPolicy({ tier: 1, per_tx_usd_micro: v })).toThrow(); });
  it.each([0, -1, 0.1])("daily %s is refused", (v) => { expect(() => buildPolicy({ tier: 1, daily_usd_micro: v })).toThrow(); });
  it("per_tx above daily is refused", () => { expect(() => buildPolicy({ tier: 1, per_tx_usd_micro: 900_000, daily_usd_micro: 800_000 })).toThrow(/daily/); });
  it("per_tx equal to daily is fine", () => { expect(() => buildPolicy({ tier: 1, per_tx_usd_micro: 800_000, daily_usd_micro: 800_000 })).not.toThrow(); });
});

describe("buildPolicy: destinations and assets", () => {
  it("no destinations means swap only", () => { expect(buildPolicy({ tier: 1 }).actions).toEqual(["swap"]); });
  it("a destination enables withdraw, mode only", () => {
    const p = buildPolicy({ tier: 1, destinations: [{ chain: "near", address: "a.near" }] });
    expect(p.actions).toEqual(["swap", "withdraw"]); expect(p.destinations.mode).toBe("only"); expect(p.destinations.list[0].memo).toBeNull();
  });
  it.each(["", "Near", "1near", "near chain", "x".repeat(65), "near/evil"])("chain %j is refused", (c) => { expect(() => buildPolicy({ tier: 1, destinations: [{ chain: c, address: "a" }] })).toThrow(); });
  it.each(["", "x".repeat(257)])("address of length %#", (a) => { expect(() => buildPolicy({ tier: 1, destinations: [{ chain: "near", address: a }] })).toThrow(); });
  it("257 destinations are refused", () => { expect(() => buildPolicy({ tier: 1, destinations: Array.from({ length: 257 }, (_, i) => ({ chain: "near", address: `a${i}.near` })) })).toThrow(); });
  it("empty asset list is refused", () => { expect(() => buildPolicy({ tier: 1, assets: [] })).toThrow(); });
  it("duplicate assets are collapsed", () => { expect(buildPolicy({ tier: 1, assets: [USD6[0], USD6[0]] }).assets).toHaveLength(1); });
  it("a non-stable asset list has no per-asset USD limits", () => { const p = buildPolicy({ tier: 1, assets: ["nep141:wrap.near"] }); expect(p.limits.per_transaction).toEqual({}); });
  it("never grants confidential, owner approval bypass or a timelock", () => { const p = buildPolicy({ tier: 3 }); expect([p.frozen, p.confidential, p.owner_approval, p.timelock_ms]).toEqual([false, false, false, 0]); });
});

const good = { quote: true, registered: true, fastfs: true, published: true, binding: { match: true } };
describe("/verify score matrix", () => {
  const keys = ["quote", "registered", "published"] as const;
  for (const k of keys) for (const idx of [0, 1]) it(`${k}=false at build ${idx} is no`, () => { expect(verdict({ ...good, [k]: false }, idx, true, true)).toBe("no"); });
  it.each([[true, true, 0, "current"], [true, true, 1, "previous"], [true, false, 0, "no"], [false, true, 0, "no"], [false, false, 1, "no"], [true, true, -1, "no"]] as const)("dcap=%s pcs=%s build=%i -> %s", (d, p, b, want) => { expect(verdict(good, b, d, p)).toBe(want); });
  it.each([[undefined, 5], [null, 5], [{ match: true }, 6], [{ match: false }, 6]] as const)("output %j gives %i checks", (o, n) => { expect(attestChecks({ ...good, output: o as never })).toHaveLength(n); });
  it("missing binding counts as a failed check, not a skipped one", () => { expect(attestChecks({ ...good, binding: undefined })).toContain(false); });
});

describe("gateway helpers", () => {
  it.each(["/attestations/by-call/00000000-0000-0000-0000-000000000000", "/attestations/by-call/b0a6eadb-cee9-400e-8eca-8b0f4df7bcec"])("ok %s", (p) => { expect(safeAttPath(p)).toBe(true); });
  it.each(["/attestations/by-call/B0A6EADB-CEE9-400E-8ECA-8B0F4DF7BCEC", "/attestations/by-call/b0a6eadb", "attestations/by-call/b0a6eadb-cee9-400e-8eca-8b0f4df7bcec", "/attestations/by-call/b0a6eadb-cee9-400e-8eca-8b0f4df7bcec/", "/attestations/by-call/b0a6eadb-cee9-400e-8eca-8b0f4df7bcec#x", "https://evil/attestations/by-call/b0a6eadb-cee9-400e-8eca-8b0f4df7bcec", undefined, {}])("bad %j", (p) => { expect(safeAttPath(p)).toBe(false); });
  const H = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
  it.each([[{ "x-real-ip": " 1.2.3.4 " }, "1.2.3.4"], [{ "x-forwarded-for": " 5.6.7.8 ,9.9.9.9" }, "5.6.7.8"], [{ "x-real-ip": "", "x-forwarded-for": "7.7.7.7" }, "7.7.7.7"], [{ "x-forwarded-for": "" }, "anon"]] as const)("%j -> %s", (h, want) => { expect(clientIp(H(h as Record<string, string>))).toBe(want); });
});
