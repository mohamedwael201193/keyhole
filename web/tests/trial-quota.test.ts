import { describe, expect, it, vi } from "vitest";
import { judgeQuota, sponsorNonceSpent, upstashIncr, type QuotaFacts } from "@/lib/trialQuota";
import { GLOBAL_PER_HOUR, GUEST_PER_IP_HOUR, LIFETIME_TX, MIN_LIQUID_YOCTO } from "@/lib/trialPolicy";
import { trialClientIp } from "@/lib/trialIp";
import { SPONSOR_NONCE_BASE } from "@/lib/trialPublic";

const base = (): QuotaFacts => ({
  liquidYocto: MIN_LIQUID_YOCTO,
  nonce: SPONSOR_NONCE_BASE + 4n,
  createsLastHour: 0,
  createsLastDay: 0,
  lifetimeCreates: 0,
  ipCreatesLastHour: null,
  ipStore: "chain",
  indexerComplete: true,
  countsIncludeThis: false,
});

describe("shared trial quota", () => {
  it("refuses when the sponsor is below the balance floor", () => {
    const d = judgeQuota({ ...base(), liquidYocto: MIN_LIQUID_YOCTO - 1n });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.status).toBe(503);
  });

  it("counts spends from the pinned access-key base, not the absolute nonce", () => {
    expect(sponsorNonceSpent(SPONSOR_NONCE_BASE + 7n)).toBe(7n);
    expect(judgeQuota({ ...base(), nonce: SPONSOR_NONCE_BASE + 7n }).ok).toBe(true);
    expect(judgeQuota({ ...base(), nonce: 1n }).ok).toBe(false);
    const spent = judgeQuota({ ...base(), nonce: SPONSOR_NONCE_BASE + BigInt(LIFETIME_TX) });
    expect(spent.ok).toBe(false);
    if (!spent.ok) expect(spent.status).toBe(429);
  });

  it("refuses a spent lifetime, a full hour, and an incomplete indexer", () => {
    expect(judgeQuota({ ...base(), nonce: SPONSOR_NONCE_BASE + BigInt(LIFETIME_TX) }).ok).toBe(false);
    expect(judgeQuota({ ...base(), createsLastHour: GLOBAL_PER_HOUR }).ok).toBe(false);
    const hour = judgeQuota({ ...base(), createsLastHour: GLOBAL_PER_HOUR });
    if (!hour.ok) expect(hour.retryAfter).toBe(3600);
    const incomplete = judgeQuota({ ...base(), indexerComplete: false, createsLastHour: 0 });
    expect(incomplete.ok).toBe(false);
    if (!incomplete.ok) expect(incomplete.status).toBe(503);
  });

  it("uses the Upstash count for one IP and does not fall back when the store errors", async () => {
    const allowed = judgeQuota({ ...base(), ipStore: "upstash", countsIncludeThis: true, ipCreatesLastHour: 1, createsLastHour: 1, createsLastDay: 1, lifetimeCreates: 1, indexerComplete: true });
    expect(allowed.ok).toBe(true);
    const blocked = judgeQuota({ ...base(), ipStore: "upstash", countsIncludeThis: true, ipCreatesLastHour: GUEST_PER_IP_HOUR + 1, createsLastHour: 1, createsLastDay: 1, lifetimeCreates: 1 });
    expect(blocked.ok).toBe(false);
    const missing = judgeQuota({ ...base(), ipStore: "upstash", ipCreatesLastHour: null });
    expect(missing.ok).toBe(false);
    await expect(upstashIncr("https://example.upstash.io", "tok", "trial:ip", 60, vi.fn(async () => new Response("no", { status: 500 })) as typeof fetch)).rejects.toThrow(/quota store/);
  });
});

describe("trial client address", () => {
  it("ignores a caller-supplied x-forwarded-for off Vercel", () => {
    const headers = { get: (n: string) => n === "x-forwarded-for" ? "203.0.113.5" : null };
    expect(trialClientIp(headers, {})).toBeNull();
  });

  it("uses the platform address and ignores a spoofed forwarded list", () => {
    const headers = { get: (n: string) => n === "x-forwarded-for" ? "203.0.113.5" : n === "x-vercel-forwarded-for" ? "198.51.100.8, 203.0.113.5" : null };
    expect(trialClientIp(headers, { VERCEL: "1" })).toBe("198.51.100.8");
  });
});
