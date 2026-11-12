"use client";
/**
 * Pledge: one screen on the foil texture, darkened. Three contract-enforced states on a line, no numbers and no rates. The real
 * key sits at the start of the line. The badge says lending is not open yet.
 */
import { useI18n } from "@/lib/i18n";

const STATES = [
  { t: "landing2.pledge.p1t", d: "landing2.pledge.p1d" },
  { t: "landing2.pledge.p2t", d: "landing2.pledge.p2d" },
  { t: "landing2.pledge.p3t", d: "landing2.pledge.p3d" },
] as const;

export function Pledge() {
  const { t } = useI18n();
  return (
    <section className="lp-sec lp-pledge" id="pledge" aria-labelledby="pledge-h">
      <div className="lp-bg" aria-hidden="true">
        <img src="/landing/foil-texture.webp" alt="" width={1376} height={768} loading="lazy" decoding="async" />
      </div>
      <div className="lp-wrap">
        <p className="lp-eyebrow">{t("landing2.pledge.eyebrow")}</p>
        <h2 id="pledge-h" className="lp-h2">{t("landing2.pledge.h2")}</h2>
        <p className="lp-badge" data-testid="lending-badge">{t("landing2.pledge.badge")}</p>
        <ol className="lp-line-steps">
          <li className="lp-line-key" aria-hidden="true">
            <img src="/heirloom/keys/k03.webp" alt={t("landing2.pledge.keyAlt")} width={433} height={1077} loading="lazy" decoding="async" />
          </li>
          {STATES.map((s, i) => (
            <li key={s.t} className="lp-line-step">
              <span className="lp-line-n mono">{String(i + 1).padStart(2, "0")}</span>
              <h3>{t(s.t)}</h3>
              <p>{t(s.d)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
