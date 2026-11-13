"use client";
/**
 * The problem: a half-screen emerald banner on the owner's golden-keyhole art (keyhole left, gold waves right in the picture).
 * The copy sits on the dark right half. A slow warm glow breathes inside the keyhole (CSS radial gradient placed from the picture's
 * own coordinates: the keyhole centre is at 23.1% across and 53% down the crop). Off under reduced motion.
 */
import { useI18n } from "@/lib/i18n";

export function Problem() {
  const { t } = useI18n();
  return (
    <section className="lp-sec lp-prob" aria-labelledby="problem-h">
      <div className="lp-wrap">
        <div className="lp-band lp-prob-band">
          <div className="lp-prob-art" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/landing/problem-keyhole.webp" alt="" width={1800} height={497} loading="lazy" decoding="async" />
            <span className="lp-prob-glow" />
          </div>
          <div className="lp-prob-copy">
            <p className="lp-eyebrow lp-eyebrow--light">{t("landing2.v2.problem.eyebrow")}</p>
            <h2 id="problem-h" className="lp-h2 lp-h2--light">{t("landing2.v2.problem.h2")}</h2>
            <p className="lp-body lp-body--light">{t("landing2.v2.problem.body")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
