"use client";
/**
 * How it works: the keyhole moment (the pinned section, components/LandingMotion.tsx). The real Bronze key (k03) seats in the
 * keyhole of the macro plate as the scroll moves; three foil cards light one after another. The plate is 16:9 and covers the
 * section; the keyhole sits at 51% across and 40% down the plate (keyhole-macro.webp), so the key lines up at any width.
 */
import { useI18n } from "@/lib/i18n";
import { FoilCard } from "@/components/FoilCard";
import { KeyholeMoment } from "@/components/LandingMotion";

const STEPS = [
  { n: "01", t: "landing2.how.s1t", d: "landing2.how.s1d", img: "/landing/step-mint.webp", alt: "landing2.how.mintAlt" },
  { n: "02", t: "landing2.how.s2t", d: "landing2.how.s2d", img: "/landing/step-use.webp", alt: "landing2.how.useAlt" },
  { n: "03", t: "landing2.how.s3t", d: "landing2.how.s3d", img: null, alt: "" },
] as const;

export function KeyholeSteps() {
  const { t } = useI18n();
  return (
    <KeyholeMoment id="handover" className="lp-moment" labelledBy="how-h">
      <div className="lp-moment-plate" aria-hidden="true">
        <picture>
          <source srcSet="/landing/keyhole-macro.avif" type="image/avif" />
          <img className="lp-moment-img" src="/landing/keyhole-macro.webp" alt="" width={1376} height={768} loading="lazy" decoding="async" />
        </picture>
        <div className="lp-moment-anchor">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img data-key className="lp-moment-key" src="/heirloom/keys/k03.webp" alt={t("landing2.how.keyAlt")} width={433} height={1077} loading="eager" decoding="async" />
        </div>
      </div>
      <div className="wrap lp-wrap lp-moment-wrap">
        <div className="lp-moment-copy">
          <p className="lp-eyebrow">{t("landing2.how.eyebrow")}</p>
          <h2 id="how-h" className="lp-h2">{t("landing2.how.h2")}</h2>
        </div>
        <ol className="lp-steps">
          {STEPS.map((s) => (
            <li key={s.n} className="lp-step" data-step>
              <FoilCard finish="Bronze" as="article" className="lp-foil">
                <div className="lp-step-body">
                  <div className="lp-step-art">
                    {s.img ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={s.img} alt={t(s.alt)} width={512} height={512} loading="lazy" decoding="async" />
                    ) : (
                      <svg viewBox="0 0 64 64" aria-hidden="true" className="lp-step-icon"><circle cx="20" cy="32" r="11" fill="none" stroke="currentColor" strokeWidth="3" /><path d="M31 32h27M48 32v9M56 32v6" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" /></svg>
                    )}
                  </div>
                  <div>
                    <p className="lp-step-n mono">{s.n}</p>
                    <h3>{t(s.t)}</h3>
                    <p>{t(s.d)}</p>
                  </div>
                </div>
              </FoilCard>
            </li>
          ))}
        </ol>
      </div>
    </KeyholeMoment>
  );
}
