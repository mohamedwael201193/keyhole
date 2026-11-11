import { describe, expect, it } from "vitest";
import { STATS_MAX_AGE_MS, staleLabel, statsPhase, takeLatest } from "@/lib/liveStatsClient";
import type { MainnetStats } from "@/lib/mainnetStats";

const stats = (fetchedAt: string): MainnetStats => ({
  live: true, contract: "keyhole-devmo.near", network: "mainnet", fetchedAt,
  totalKeys: { ok: true, value: 6 }, holders: { ok: true, value: 6 }, activeLiens: { ok: true, value: 0 },
  latestEvent: { ok: true, value: { hash: "89vSYY4tbeNPuNuhHB8YmkkAWAcjW5VdniQm3ePHuPYz", method: "nft_list", at: fetchedAt } },
});

describe("live stats client", () => {
  it("a hung first read is unavailable, and an old success is Stale with its age", () => {
    expect(statsPhase({ stats: null, receivedAt: null, now: 10_000, loading: false }).phase).toBe("unavailable");
    const at = 1_000;
    const now = at + STATS_MAX_AGE_MS + 1;
    const phase = statsPhase({ stats: stats(new Date(at).toISOString()), receivedAt: at, now, loading: false });
    expect(phase.phase).toBe("stale");
    expect(staleLabel(phase.ageMs ?? 0)).toMatch(/min ago|s ago/);
    expect(statsPhase({ stats: stats(new Date(at).toISOString()), receivedAt: at, now: at + 1_000, loading: false }).phase).toBe("live");
  });

  it("an older reply cannot overwrite a newer one", () => {
    const newer = { n: 2 };
    const older = { n: 1 };
    expect(takeLatest(2, 1, older)).toBeNull();
    expect(takeLatest(2, 2, newer)).toEqual(newer);
  });
});
