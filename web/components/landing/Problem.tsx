"use client";
import { useI18n } from "@/lib/i18n";

/** The problem: one screen, a square still on the left and one short paragraph on the right. */
export function Problem() {
  const { t } = useI18n();
  return (
    <section className="lp-sec lp-problem" id="problem" aria-labelledby="problem-h">
      <div className="lp-wrap lp-split">
        <div className="lp-square">
          <picture>
            <source srcSet="/landing/problem-paper.avif" type="image/avif" />
            <img src="/landing/problem-paper.webp" alt={t("landing2.problem.imgAlt")} width={768} height={768} loading="lazy" decoding="async" />
          </picture>
        </div>
        <div className="lp-split-copy">
          <p className="lp-eyebrow">{t("landing2.problem.eyebrow")}</p>
          <h2 id="problem-h" className="lp-h2">{t("landing2.problem.h2")}</h2>
          <p className="lp-lead">{t("landing2.problem.body")}</p>
        </div>
      </div>
    </section>
  );
}
