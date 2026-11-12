"use client";
/**
 * Hero: one screen. The loop plays behind a dark left-to-right gradient; the copy is on the left and the real Bronze key
 * (k03, the site's own art) is on the right. The key rises once on load (CSS, off under reduced motion). The video is paused
 * under reduced motion, so the poster is the still frame.
 */
import { useEffect, useRef } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { KEYS_CONTRACT, acct } from "@/lib/config";

export function LandingHero() {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("no-motion");
    if (still) { v.pause(); return; }
    void v.play().catch(() => {});
  }, []);
  return (
    <section className="lp-sec lp-hero" id="top" aria-labelledby="hero-h">
      <video
        ref={video}
        className="lp-hero-video"
        muted
        loop
        playsInline
        autoPlay
        preload="metadata"
        poster="/landing/hero-vault.webp"
        aria-hidden="true"
        tabIndex={-1}
      >
        <source src="/landing/hero-loop.webm" type="video/webm" />
        <source src="/landing/hero-loop.mp4" type="video/mp4" />
      </video>
      <div className="lp-hero-shade" aria-hidden="true" />
      <div className="wrap lp-wrap lp-hero-grid">
        <div className="lp-hero-copy">
          <p className="lp-eyebrow"><span className="lp-dot" aria-hidden="true" />{t("landing2.hero.eyebrow")}</p>
          <h1 id="hero-h" className="lp-h1">{t("landing2.hero.h1")}</h1>
          <p className="lp-lead">{t("landing2.hero.lead")}</p>
          <p className="lp-fact">
            <span>{t("landing2.hero.contract")}</span>
            <a href={acct(KEYS_CONTRACT)} target="_blank" rel="noopener noreferrer" className="mono">{KEYS_CONTRACT} ↗</a>
          </p>
          <div className="lp-cta">
            <Link href="/mint" className="lp-btn lp-btn--brass" data-testid="start-cta">{t("landing2.hero.mint")}</Link>
            <Link href="/verify" className="lp-btn lp-btn--line" data-testid="verify-cta">{t("landing2.hero.verify")}</Link>
          </div>
          <p className="lp-trial"><Link href="/try?start=1" className="lp-link" data-testid="try-free-cta">{t("landing2.hero.trial")}</Link></p>
        </div>
        <div className="lp-hero-key">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="lp-hero-art"
            src="/heirloom/keys/k03.webp"
            alt={t("landing2.hero.keyAlt")}
            width={433}
            height={1077}
            fetchPriority="high"
            decoding="sync"
          />
        </div>
      </div>
    </section>
  );
}
