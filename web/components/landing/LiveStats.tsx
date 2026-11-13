"use client";
/**
 * Live on mainnet. Keys held by users is the server-read supply (it polls /api/supply when that read failed); Holders is the
 * /api/mainnet-stats panel's own field. A refresh that hangs is aborted and a reply from an older request is ignored. A number
 * older than STATS_MAX_AGE_MS is labelled Stale, not Live. The fifth tile is the link to /verify. No number is fixed in this file.
 */
import { nearTx } from "@/lib/explorer";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { KEYS_CONTRACT, acct } from "@/lib/config";
import { STATS_FETCH_TIMEOUT_MS, staleLabel, statsPhase, takeLatest } from "@/lib/liveStatsClient";
import type { MainnetStats } from "@/lib/mainnetStats";
import { Icon } from "./icons";
import { SupplyStat } from "./Proof";

function num(stat: { ok: boolean; value: number | null } | undefined, phase: string): string {
  if (phase === "loading") return "…";
  if (phase === "unavailable" || !stat?.ok || stat.value == null) return "—";
  return String(stat.value);
}

export function LiveStats({ supply }: { supply: number | null }) {
  const { t } = useI18n();
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
  const tag = phase === "stale" ? `${t("landing2.v2.live.stale")} · ${staleLabel(ageMs ?? 0)}` : phase === "loading" ? t("landing2.v2.live.reading") : phase === "unavailable" ? t("landing2.v2.live.unavailable") : null;

  return (
    <div className="lp-live" data-testid="mainnet-stats" data-phase={phase}>
      <p className="lp-eyebrow lp-eyebrow--light lp-live-head">
        <a href={acct(KEYS_CONTRACT)} target="_blank" rel="noopener noreferrer" data-testid="mainnet-badge">
          <i className={`lp-pulse${phase === "live" ? "" : " is-off"}`} aria-hidden="true" />{t("landing2.v2.live.eyebrow")}
        </a>
        {tag && <span className="lp-live-tag">{tag}</span>}
      </p>
      <dl className="lp-stats">
        <div className="lp-stat">
          <Icon name="key" size={28} className="lp-stat-ico" />
          <dd data-testid="keys-stat"><Link href="/keys" className="lp-stat-link"><SupplyStat initial={supply} /></Link></dd>
          <dt>{t("home.supplyLabel")}</dt>
        </div>
        <div className="lp-stat">
          <Icon name="layers" size={28} className="lp-stat-ico" />
          <dd data-testid="stat-holders">{num(stats?.holders, phase)}</dd>
          <dt>{t("landing2.v2.live.holders")}</dt>
        </div>
        <div className="lp-stat">
          <Icon name="lock" size={28} className="lp-stat-ico" />
          <dd data-testid="stat-liens">{num(stats?.activeLiens, phase)}</dd>
          <dt>{t("landing2.v2.live.liens")}</dt>
        </div>
        <div className="lp-stat">
          <Icon name="swap" size={28} className="lp-stat-ico" />
          <dd data-testid="stat-event">
            {phase === "loading" ? "…" : event?.ok && event.value ? (
              <a href={nearTx(event.value.hash)} target="_blank" rel="noreferrer">
                {event.value.method}
              </a>
            ) : "—"}
          </dd>
          <dt>{t("landing2.v2.live.event")}</dt>
        </div>
        <div className="lp-stat">
          <Icon name="shield" size={28} className="lp-stat-ico" />
          <dd><Link href="/verify" className="lp-stat-link lp-stat-verify" data-testid="verify-cta">{t("landing2.v2.live.verify")}<Icon name="arrow" size={18} /></Link></dd>
          <dt>{t("landing2.v2.live.verifyTitle")}</dt>
        </div>
      </dl>
    </div>
  );
}
