"use client";
/** Close: the vault arch, full bleed, one line and the two actions. The site footer follows from the layout. */
import Link from "next/link";
import { useI18n } from "@/lib/i18n";

export function Close() {
  const { t } = useI18n();
  return (
    <section className="lp-sec lp-end" id="cta" aria-labelledby="cta-h">
      <div className="lp-bg" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/landing/footer-arch.webp" alt="" width={1376} height={590} loading="lazy" decoding="async" />
      </div>
      <div className="wrap lp-wrap lp-end-copy">
        <h2 id="cta-h" className="lp-h2">{t("landing2.close.h2")}</h2>
        <div className="lp-cta lp-cta--center">
          <Link href="/mint" className="lp-btn lp-btn--brass" data-testid="cta-get-key">{t("landing2.close.mint")}</Link>
          <Link href="/verify" className="lp-btn lp-btn--line" data-testid="cta-proof">{t("landing2.close.verify")}</Link>
        </div>
      </div>
    </section>
  );
}
