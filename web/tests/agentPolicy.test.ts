import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { buildPolicy, TIER_CAPS, USD6, usdString } from "../lib/agentPolicy";
import { agentPath, drySwapBody, redact, policyWarnings, canon } from "../lib/agentApi";
import { OC_ASSETS } from "../lib/oneclick";

const USDC_NEAR = OC_ASSETS[0].id;
const evDir = new URL("../../docs/evidence/agent-api/", import.meta.url);
const ev = JSON.parse(readFileSync(new URL(readdirSync(evDir).filter((f) => f.endsWith(".json")).sort().at(-1)!, evDir), "utf8"));

describe("policy builder: KEYHOLE caps -> Agent API policy", () => {
  it("tier caps are the enclave's numbers (read from tee/worker/src/lib.rs)", () => {
    const src = readFileSync(new URL("../../tee/worker/src/lib.rs", import.meta.url), "utf8");
    for (const [t, c] of Object.entries(TIER_CAPS)) {
      const m = src.match(new RegExp(`${t} => Some\\(Limits \\{ per_tx_usd_micro: ([\\d_]+), daily_usd_micro: ([\\d_]+), per_minute_calls: (\\d+)`))!;
      expect([m[1], m[2], m[3]].map((x) => Number(x.replace(/_/g, "")))).toEqual([c.per_tx_usd_micro, c.daily_usd_micro, c.per_minute_calls]);
    }
  });
  it.each([[1, "1000000", "5000000", "5.00", 360], [2, "10000000", "50000000", "50.00", 720], [3, "100000000", "500000000", "500.00", 1800]] as const)(
    "tier %i maps to per-tx %s, daily %s, budget $%s, %i actions/h", (t, pt, d, usd, ph) => {
      const p = buildPolicy({ tier: t });
      expect(p.limits.per_transaction[USDC_NEAR]).toBe(pt);
      expect(p.limits.daily[USDC_NEAR]).toBe(d);
      expect(p.budget.daily_usd).toBe(usd);
      expect(p.max_actions_per_hour).toBe(ph);
    });
  it("per-asset limits only on 6-decimal USDC, where base units equal USD micro", () => {
    const p = buildPolicy({ tier: 1 });
    expect(Object.keys(p.limits.per_transaction).sort()).toEqual([...USD6].sort());
    for (const id of USD6) expect(OC_ASSETS.find((a) => a.id === id)!.decimals).toBe(6);
    expect(p.limits.per_transaction["nep141:wrap.near"]).toBeUndefined();
  });
  it("holder limits below the tier cap are used; above it are clamped down", () => {
    expect(buildPolicy({ tier: 1, per_tx_usd_micro: 250_000 }).limits.per_transaction[USDC_NEAR]).toBe("250000");
    const p = buildPolicy({ tier: 1, per_tx_usd_micro: 9_000_000, daily_usd_micro: 9_000_000 });
    expect(p.limits.per_transaction[USDC_NEAR]).toBe("1000000");
    expect(p.budget.daily_usd).toBe("5.00");
  });
  it.each([[0], [-1], [1.5], [Number.NaN], [2 ** 60]])("refuses holder limit %s", (v) => expect(() => buildPolicy({ tier: 1, per_tx_usd_micro: v })).toThrow());
  it("refuses per-tx above daily and unknown tiers", () => {
    expect(() => buildPolicy({ tier: 2, per_tx_usd_micro: 3_000_000, daily_usd_micro: 2_000_000 })).toThrow(/daily/);
    for (const t of [0, 4, 1.5]) expect(() => buildPolicy({ tier: t })).toThrow(/tier/);
  });
  it("no destinations means no withdraw action and an empty allow-list (fail closed)", () => {
    const p = buildPolicy({ tier: 1 });
    expect(p.actions).toEqual(["swap"]);
    expect(p.destinations).toEqual({ mode: "only", list: [] });
  });
  it("allowed destinations become an 'only' list and enable withdraw", () => {
    const p = buildPolicy({ tier: 1, destinations: [{ chain: "sol", address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" }] });
    expect(p.actions).toEqual(["swap", "withdraw"]);
    expect(p.destinations.list).toEqual([{ action: "withdraw", chain: "sol", address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", memo: null }]);
  });
  it.each([["SOL", "x"], ["sol", ""], ["9sol", "x"], ["sol", "x".repeat(257)]])("refuses destination chain=%s", (chain, address) =>
    expect(() => buildPolicy({ tier: 1, destinations: [{ chain, address }] })).toThrow(/destination/));
  it("asset list is de-duplicated, bounded and narrows the per-asset limits", () => {
    const p = buildPolicy({ tier: 1, assets: [USDC_NEAR, USDC_NEAR, "nep141:wrap.near"] });
    expect(p.assets).toEqual([USDC_NEAR, "nep141:wrap.near"]);
    expect(Object.keys(p.limits.daily)).toEqual([USDC_NEAR]);
    expect(() => buildPolicy({ tier: 1, assets: [] })).toThrow();
    expect(() => buildPolicy({ tier: 1, assets: Array.from({ length: 129 }, (_, i) => `a${i}`) })).toThrow();
  });
  it.each([[5_000_000, "5.00"], [1_239_999, "1.23"], [9_999, "0.00"], [500_000_000, "500.00"], [10_000, "0.01"]])("usdString(%i) = %s (rounds down)", (m, s) => expect(usdString(m)).toBe(s));
  it("budget strings match the API's pattern", () => {
    for (const t of [1, 2, 3]) expect(buildPolicy({ tier: t }).budget.daily_usd).toMatch(/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,2})?$/);
  });
});

describe("live evidence (docs/evidence/agent-api) agrees with the builder", () => {
  it("the applied policy on the demo agent is exactly buildPolicy({tier: 1})", () => {
    expect(ev.policy.body.status).toBe("APPLIED");
    expect(ev.policy.body.policy).toMatchObject(buildPolicy({ tier: 1 }));
  });
  it("a $0.50 dry swap has no policy warning; a $2 one hits the tier-1 per-transaction cap", () => {
    expect(policyWarnings(ev.dry_swap_ok.body)).toEqual([]);
    expect(policyWarnings(ev.dry_swap_over_cap.body)).toEqual(["policy_transaction_limit_exceeded"]);
    expect(ev.dry_swap_ok.body.spend.budget.daily.limit_usd).toBe("5.00");
  });
  it("every captured swap is dry and the network is mainnet", () => {
    for (const k of Object.keys(ev).filter((k) => k.startsWith("dry_swap"))) expect(ev[k].body.dry).toBe(true);
    expect(ev.network.body.network).toBe("mainnet");
  });
  it("identifiers are redacted", () => {
    const s = JSON.stringify(ev);
    expect(s).not.toMatch(/"(api_key_id|tenant_id)":"[0-9a-f]{64}"/);
    expect(s).not.toMatch(/\/agents\/[0-9a-f]{64}/);
    expect(s).toContain("<redacted:");
  });
});

describe("Agent API route helpers", () => {
  const A = "ab".repeat(32);
  it.each([["network", "/v1/network"], ["whoami", "/v1/whoami"], ["quotas", "/v1/quotas"], ["policy", `/v1/agents/${A}/policy`]])("read %s -> %s", (r, p) => expect(agentPath(r, A)).toBe(p));
  it.each(["", "agents", "../v1/agents", "swap", "tokens?x=1"])("refuses read %j", (r) => expect(agentPath(r, A)).toBeNull());
  it("policy read needs a well-formed server-side agent id", () => { expect(agentPath("policy", undefined)).toBeNull(); expect(agentPath("policy", "x")).toBeNull(); });
  it("dry swap body is always dry and allow-listed", () => {
    expect(drySwapBody({ origin: USDC_NEAR, dest: "nep141:wrap.near", amount: "500000" })).toEqual({ origin_asset: USDC_NEAR, destination_asset: "nep141:wrap.near", amount: "500000", dry: true });
    expect(drySwapBody({ origin: USDC_NEAR, dest: "nep141:wrap.near", amount: "500000", dry: false } as never)!.dry).toBe(true);
  });
  it.each([
    [{ origin: "nep141:evil.near", dest: "nep141:wrap.near", amount: "1" }], [{ origin: USDC_NEAR, dest: USDC_NEAR, amount: "1" }],
    [{ origin: USDC_NEAR, dest: "nep141:wrap.near", amount: "0" }], [{ origin: USDC_NEAR, dest: "nep141:wrap.near", amount: "1.5" }],
    [{ origin: USDC_NEAR, dest: "nep141:wrap.near", amount: 5 }], [{}],
  ])("refuses swap %j", (b) => expect(drySwapBody(b as never)).toBeNull());
  it("whoami never reaches the browser in full; policy drops the wallet id", () => {
    expect(redact("whoami", { api_key_id: "9f71a41c" + "0".repeat(56), tenant_id: "d1" + "0".repeat(62) })).toEqual({ api_key_id: "9f71a4…", tenant_id: "d10000…" });
    expect(redact("policy", { wallet_id: "w", revision: 1 })).toEqual({ revision: 1 });
  });
});

describe("canon", () => {
  it("ignores key order, keeps array order and values", () => {
    expect(canon({ b: 1, a: { d: [2, 1], c: null } })).toBe(canon({ a: { c: null, d: [2, 1] }, b: 1 }));
    expect(canon({ a: [1, 2] })).not.toBe(canon({ a: [2, 1] }));
    expect(canon({ a: "1" })).not.toBe(canon({ a: 1 }));
  });
});
