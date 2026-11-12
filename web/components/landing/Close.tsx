"use client";
/** Close: one cream card with a small crop of the ivy arch, the line and the two actions. The site footer follows from the layout. */
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { Icon } from "./icons";
import { ARCH_KEYS, CROP, keyBox } from "./archGeometry";

export function Close() {
  const { t } = useI18n();
  return (
    <section className="lp-sec lp-end" id="cta" aria-labelledby="cta-h">
      <div className="lp-wrap">
        <div className="lp-card lp-end-card">
          <div className="lp-end-art" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/landing/hero-arch.webp" alt="" width={CROP.w} height={CROP.h} loading="lazy" decoding="async" />
            {ARCH_KEYS.map((k) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={k.n} className="lp-akey" style={keyBox(k)} src={`/heirloom/keys/k0${k.n}.webp`} alt="" width={433} height={1077} loading="lazy" decoding="async" />
            ))}
          </div>
          <div className="lp-end-copy">
            <h2 id="cta-h" className="lp-h2 lp-h2--sm">{t("landing2.v2.close.h2")}</h2>
            <div className="lp-cta lp-cta--tight">
              <Link href="/dashboard" className="lp-btn lp-btn--primary" data-testid="cta-launch">{t("landing2.v2.close.launch")}<Icon name="arrow" size={18} /></Link>
              <Link href="/mint" className="lp-btn lp-btn--ghost" data-testid="cta-get-key">{t("landing2.v2.close.mint")}</Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
