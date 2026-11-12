"use client";
/**
 * Live proof: one screen on the stone texture. Left: live numbers only (keys held by people from loadLanding, the 1Click token and
 * chain count from loadTokenReach) and the worker hash, which is a build constant and says so. Right: the real mainnet panel
 * (LiveStats, /api/mainnet-stats), in an app frame.
 */
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { KEYS_CONTRACT, acct } from "@/lib/config";
import type { TokenReach } from "@/lib/landing";
import type { publicOrderCensus } from "@/lib/settlements";
import { SupplyStat } from "./Proof";
import { LiveStats } from "./LiveStats";

const SOURCE = "https://github.com/mohamedwael201193/keyhole";

export function ProofBand({ supply, hash, reach, orders }: { supply: number | null; hash: string; reach: TokenReach | null; orders: ReturnType<typeof publicOrderCensus> }) {
  const { t } = useI18n();
  return (
    <section className="lp-sec lp-proof" id="proof" aria-labelledby="proof-h">
      <div className="lp-bg" aria-hidden="true">
        <img src="/landing/stone-texture.webp" alt="" width={1376} height={768} loading="lazy" decoding="async" />
      </div>
      <div className="wrap lp-wrap lp-proof-grid">
        <div className="lp-proof-copy">
          <p className="lp-eyebrow">{t("landing2.proof.eyebrow")}</p>
          <h2 id="proof-h" className="lp-h2">{t("landing2.proof.h2")}</h2>
          <dl className="lp-figs">
            <div>
              <dt>{t("home.supplyLabel")} <span className="lp-live-tag"><i aria-hidden="true" />{t("landing2.proof.liveTag")}</span></dt>
              <dd><Link href="/keys" className="lp-fig-link" data-testid="keys-stat"><SupplyStat initial={supply} /></Link></dd>
            </div>
            <div>
              <dt>{t("landing2.proof.tokens")} <span className="lp-live-tag"><i aria-hidden="true" />{t("landing2.proof.liveTag")}</span></dt>
              <dd data-testid="reach-tokens">{reach ? reach.tokens : "—"}</dd>
            </div>
            <div>
              <dt>{t("landing2.proof.chains")} <span className="lp-live-tag"><i aria-hidden="true" />{t("landing2.proof.liveTag")}</span></dt>
              <dd data-testid="reach-chains">{reach ? reach.chains : "—"}</dd>
            </div>
            <div>
              <dt>{orders.label} <span className="lp-build-tag">{t("landing2.proof.recordTag")}</span></dt>
              <dd data-testid="orders-stat" title={orders.detail}>{orders.total}</dd>
            </div>
            <div>
              <dt>{t("landing2.proof.build")} <span className="lp-build-tag">{t("landing2.proof.buildTag")}</span></dt>
              <dd className="mono" data-testid="hash-stat">{hash}</dd>
            </div>
          </dl>
          <p className="lp-cta lp-cta--tight">
            <Link href="/verify" className="lp-link">{t("landing2.proof.verify")}</Link>
            <a href={acct(KEYS_CONTRACT)} target="_blank" rel="noopener noreferrer" className="lp-link">{t("landing2.proof.contract")} ↗</a>
            <a href={SOURCE} target="_blank" rel="noopener noreferrer" className="lp-link">{t("landing2.proof.source")} ↗</a>
          </p>
        </div>
        <div className="lp-app" aria-label={t("landing2.proof.h2")}>
          <div className="lp-app-bar" aria-hidden="true"><i /><i /><i /></div>
          <LiveStats />
        </div>
      </div>
    </section>
  );
}
