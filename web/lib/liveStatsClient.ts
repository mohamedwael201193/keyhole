import type { MainnetStats } from "./mainnetStats";

export const STATS_FETCH_TIMEOUT_MS = 8_000;
/** After this, a number that was live is labelled Stale. It is not called live. */
export const STATS_MAX_AGE_MS = 60_000;

export type StatsPhase = "loading" | "live" | "stale" | "unavailable";

/** Drop a reply that is not the newest request. An older response cannot overwrite a newer one. */
export function takeLatest<T>(latestSeq: number, replySeq: number, value: T): T | null {
  return replySeq === latestSeq ? value : null;
}

export function statsPhase(input: {
  stats: MainnetStats | null;
  receivedAt: number | null;
  now: number;
  loading: boolean;
}): { phase: StatsPhase; ageMs: number | null } {
  const { stats, receivedAt, now, loading } = input;
  if (loading && !stats?.live) return { phase: "loading", ageMs: null };
  if (!stats?.live || receivedAt == null || !stats.fetchedAt) return { phase: "unavailable", ageMs: null };
  const dataAt = Date.parse(stats.fetchedAt);
  if (!Number.isFinite(dataAt)) return { phase: "unavailable", ageMs: null };
  const ageMs = now - Math.min(receivedAt, dataAt);
  if (ageMs > STATS_MAX_AGE_MS) return { phase: "stale", ageMs };
  return { phase: "live", ageMs };
}

export function staleLabel(ageMs: number): string {
  const sec = Math.max(0, Math.round(ageMs / 1000));
  if (sec < 90) return `${sec}s ago`;
  return `${Math.round(sec / 60)} min ago`;
}
