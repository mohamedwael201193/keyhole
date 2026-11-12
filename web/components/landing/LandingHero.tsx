"use client";
/**
 * Hero: one screen. Left, the headline and the two actions. Right, the ivy arch (the owner's art, the three generated keys painted
 * out of it) with the REAL key art standing on the pedestals: k03 Bronze, k04 Silver, k02 Gold (/heirloom/keys). The real keys are
 * placed from the arch image's own pixel coordinates, as percentages of the cropped picture, so they sit on the same spot at every width.
 * The keys rise once on load, then float; a halo ring breathes behind the Silver key and a foil light crosses each key. A pause
 * control stops all of it. Reduced motion and ?static: everything rests.
 */
import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { Icon, type IconName } from "./icons";
import { GoldWaves } from "./GoldWaves";
import { LoopControl } from "./LoopControl";

/** hero-arch.webp is the source picture (1199 x 1312) cropped to x 320..1199, y 0..590. Source pixel numbers below. */
const CROP = { x: 320, y: 0, w: 879, h: 590 } as const;

type HeroKey = { n: number; tier: "Bronze" | "Silver" | "Gold"; alt: string; cx: number; base: number; w: number; ar: number; plaqueY: number; plaqueW: number };

/**
 * cx and base are the generated key's stem centre and the foot of its finial on the pedestal, measured in the source picture. The real key is a
 * little larger than the one it replaces (w is its width in source pixels; the height follows its own aspect ratio).
 */
const KEYS: HeroKey[] = [
  { n: 3, tier: "Bronze", alt: "landing2.v2.hero.keyBronze", cx: 660, base: 418, w: 136, ar: 433 / 1077, plaqueY: 446, plaqueW: 124 },
  { n: 4, tier: "Silver", alt: "landing2.v2.hero.keySilver", cx: 817.5, base: 390, w: 130, ar: 406 / 1084, plaqueY: 432, plaqueW: 132 },
  { n: 2, tier: "Gold", alt: "landing2.v2.hero.keyGold", cx: 972, base: 418, w: 132, ar: 409 / 1094, plaqueY: 446, plaqueW: 124 },
];

const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;

function keyBox(k: HeroKey) {
  const h = k.w / k.ar;
  return { left: pct(k.cx - k.w / 2 - CROP.x, CROP.w), top: pct(k.base - h - CROP.y, CROP.h), width: pct(k.w, CROP.w), height: pct(h, CROP.h) };
}

const STRIP: { icon: IconName; t: string; d: string; href: string }[] = [
  { icon: "shield", t: "landing2.v2.strip.tee", d: "landing2.v2.strip.teeSub", href: "#private" },
  { icon: "layers", t: "landing2.v2.strip.intents", d: "landing2.v2.strip.intentsSub", href: "#handover" },
  { icon: "swap", t: "landing2.v2.strip.transfer", d: "landing2.v2.strip.transferSub", href: "#lockout" },
  { icon: "coins", t: "landing2.v2.strip.pledge", d: "landing2.v2.strip.pledgeSub", href: "#pledge" },
];

export function LandingHero() {
  const { t } = useI18n();
  const [paused, setPaused] = useState(false);
  return (
    <section className="lp-hero" id="top" aria-labelledby="hero-h">
      <div className="lp-hero-stage">
        <div className="lp-wrap lp-hero-grid">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow lp-eyebrow--rule" data-enter style={{ "--i": 0 } as React.CSSProperties}>{t("landing2.v2.hero.eyebrow")}</p>
            <h1 id="hero-h" className="lp-h1" data-enter style={{ "--i": 1 } as React.CSSProperties}>
              {t("landing2.v2.hero.h1a")} <em>{t("landing2.v2.hero.h1b")}</em>
            </h1>
            <p className="lp-lead" data-enter style={{ "--i": 2 } as React.CSSProperties}>{t("landing2.v2.hero.body")}</p>
            <div className="lp-cta" data-enter style={{ "--i": 3 } as React.CSSProperties}>
              <Link href="/dashboard" className="lp-btn lp-btn--primary" data-testid="start-cta">{t("landing2.v2.hero.launch")}<Icon name="arrow" size={18} /></Link>
              <Link href="/attack" className="lp-btn lp-btn--ghost" data-testid="watch-cta"><Icon name="play" size={16} />{t("landing2.v2.hero.watch")}</Link>
            </div>
            <p className="lp-trial" data-enter style={{ "--i": 4 } as React.CSSProperties}><Link href="/try?start=1" className="lp-textlink" data-testid="try-free-cta">{t("landing2.v2.hero.trial")}</Link></p>
          </div>
        </div>
        <figure className="lp-hero-art" data-paused={paused ? "true" : "false"}>
          <GoldWaves variant="hero" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="lp-hero-img" src="/landing/hero-arch.webp" alt={t("landing2.v2.hero.artAlt")} width={CROP.w} height={CROP.h} fetchPriority="high" decoding="sync" />
          <span className="lp-halo" aria-hidden="true" style={{ left: pct(817.5 - CROP.x, CROP.w), top: pct(236, CROP.h) }} />
          {KEYS.map((k, i) => (
            <span key={k.n} className="lp-key" style={{ ...keyBox(k), "--i": i, "--key": `url(/heirloom/keys/k0${k.n}.webp)` } as React.CSSProperties}>
              <span className="lp-key-float">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/heirloom/keys/k0${k.n}.webp`} alt={t(k.alt)} width={433} height={1077} fetchPriority="high" decoding="async" data-testid={`hero-key-${k.tier.toLowerCase()}`} />
              </span>
            </span>
          ))}
          {KEYS.map((k) => (
            <span key={k.tier} className={`lp-plaque lp-plaque--${k.tier.toLowerCase()}`} aria-hidden="true" style={{ left: pct(k.cx - CROP.x, CROP.w), top: pct(k.plaqueY - CROP.y, CROP.h), width: pct(k.plaqueW, CROP.w) }}>{k.tier}</span>
          ))}
          <LoopControl className="lp-hero-ctl" paused={paused} onToggle={() => setPaused((p) => !p)} pauseLabel={t("landing2.v2.hero.pause")} playLabel={t("landing2.v2.hero.play")} />
        </figure>
      </div>
      <nav className="lp-wrap lp-strip" aria-label={t("landing2.v2.strip.label")}>
        {STRIP.map((s) => (
          <a key={s.href} className="lp-strip-item" href={s.href}>
            <Icon name={s.icon} size={30} className="lp-strip-ico" />
            <span><b>{t(s.t)}</b><small>{t(s.d)}</small></span>
          </a>
        ))}
      </nav>
    </section>
  );
}
