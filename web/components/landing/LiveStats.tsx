"use client";
/**
 * Live mainnet counts. A refresh that hangs is aborted. A reply from an older request is ignored.
 * Numbers older than STATS_MAX_AGE_MS are labelled Stale, not Live.
 */
import { useEffect, useRef, useState } from "react";
import { KEYS_CONTRACT, acct } from "@/lib/config";
import { STATS_FETCH_TIMEOUT_MS, staleLabel, statsPhase, takeLatest } from "@/lib/liveStatsClient";
import type { MainnetStats } from "@/lib/mainnetStats";

function num(stat: { ok: boolean; value: number | null } | undefined, phase: string): string {
  if (phase === "loading") return "…";
  if (phase === "unavailable" || !stat?.ok || stat.value == null) return "unavailable";
  return String(stat.value);
}

export function LiveStats() {
  const [stats, setStats] = useState<MainnetStats | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const seq = useRef(0);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    let stop = false;
    const tick = () => {
      const id = ++seq.current;
      const ac = new AbortController();
      const timer = window.setTimeout(() => ac.abort(), STATS_FETCH_TIMEOUT_MS);
      fetch("/api/mainnet-stats", { cache: "no-store", signal: ac.signal })
        .then((r) => { if (!r.ok) throw new Error("stats"); return r.json() as Promise<MainnetStats>; })
        .then((j) => {
          if (stop || takeLatest(seq.current, id, j) == null) return;
          setStats(j);
          setReceivedAt(Date.now());
          setLoading(false);
        })
        .catch(() => {
          if (stop || takeLatest(seq.current, id, true) == null) return;
          setLoading(false);
          setStats((prev) => (prev?.live ? prev : null));
        })
        .finally(() => window.clearTimeout(timer));
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => { stop = true; window.clearInterval(id); };
  }, []);

  const { phase, ageMs } = statsPhase({ stats, receivedAt, now, loading });
  const event = phase === "unavailable" ? undefined : stats?.latestEvent;
  const badge = phase === "loading"
    ? `Reading NEAR mainnet · ${KEYS_CONTRACT}`
    : phase === "live"
      ? `Live on NEAR mainnet · ${KEYS_CONTRACT}`
      : phase === "stale"
        ? `Stale · ${staleLabel(ageMs ?? 0)} · ${KEYS_CONTRACT}`
        : `NEAR mainnet · ${KEYS_CONTRACT} · unavailable`;

  return (
    <div className="lp-live" data-testid="mainnet-stats">
        <p className="lp-live-badge" data-testid="mainnet-badge">
          <a href={acct(KEYS_CONTRACT)} target="_blank" rel="noreferrer">{badge}</a>
        </p>
        <dl className="lp-live-stats">
          <div>
            <dt>Keys minted</dt>
            <dd data-testid="stat-keys">{num(stats?.totalKeys, phase)}</dd>
          </div>
          <div>
            <dt>Holders</dt>
            <dd data-testid="stat-holders">{num(stats?.holders, phase)}</dd>
          </div>
          <div>
            <dt>Active liens</dt>
            <dd data-testid="stat-liens">{num(stats?.activeLiens, phase)}</dd>
          </div>
          <div>
            <dt>Latest key event</dt>
            <dd data-testid="stat-event">
              {phase === "loading" ? "…" : event?.ok && event.value ? (
                <a href={`https://nearblocks.io/txns/${event.value.hash}`} target="_blank" rel="noreferrer">
                  {event.value.method}
                </a>
              ) : "unavailable"}
            </dd>
          </div>
        </dl>
    </div>
  );
}
