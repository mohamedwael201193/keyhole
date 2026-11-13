"use client";
/**
 * The lock-out moment, dealt moment 2 and the payoff. A deep-emerald band on the arch art. Two glass cards: the previous holder is
 * refused (the real code `not_owner`), the new holder has access. While the section is in view a 6 s loop runs (each card always shows its name and a status pill: Holds the key, then Refused; Waiting, then Access granted): the real Bronze
 * key (k03) travels the arrow to the new holder; when it lands, the left card dims red with a 2 px shake and the right card glows
 * green; both hold, then it resets. A pause control stops it. Reduced motion and ?static: the final state, no loop, no key.
 */
import { useRef } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { tx } from "@/lib/config";
import { useLoop } from "../LandingMotion";
import { GoldWaves } from "./GoldWaves";
import { Icon } from "./icons";
import { LoopControl } from "./LoopControl";

/** The in-contract sale: the buyer buys, then the old owner is refused `not_owner` (README.md, "Current build" and the sale evidence). */
/** The attested call where the previous holder is refused `not_owner` (web/public/evidence, listed on /judge). */
const REFUSED_CALL = "e805f050-d416-4a04-9b12-270adbe02068";
const SALE_TX = "BbTs3JZaxdrgwPu6SjZQwjpuXk7wAxizeVqzKrS2pxNp";

export function Lockout() {
  const { t } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const loop = useLoop(ref);
  return (
    <section className="lp-sec lp-lock" id="lockout" aria-labelledby="lockout-h" ref={ref}>
      <div className="lp-wrap">
        <div className="lp-band lp-lock-band">
          <div className="lp-lock-bg" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/landing/arch-teal.webp" alt="" width={2000} height={667} loading="lazy" decoding="async" />
          </div>
          <GoldWaves variant="lock" />
          <div className="lp-lock-copy">
            <p className="lp-eyebrow lp-eyebrow--light">{t("landing2.v2.lock.eyebrow")}</p>
            <h2 id="lockout-h" className="lp-h2 lp-h2--light">{t("landing2.v2.lock.h2")}</h2>
            <p className="lp-body lp-body--light">{t("landing2.v2.lock.body")}</p>
            <div className="lp-cta lp-cta--tight">
              <Link href={`/verify?call=${REFUSED_CALL}`} className="lp-btn lp-btn--outline" data-testid="lock-verify">{t("landing2.v2.lock.proof")}<Icon name="out" size={17} /></Link>
              <a href={tx(SALE_TX)} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn--outline" data-testid="lock-tx">{t("landing2.v2.lock.tx")}<Icon name="out" size={17} /></a>
            </div>
          </div>
          <div className="lp-lock-stage" data-loop={loop.running ? "on" : "off"}>
            <article className="lp-holder lp-holder--prev" data-testid="lock-left">
              <span className="lp-tint" aria-hidden="true" />
              <Icon name="user" size={40} className="lp-holder-ico" />
              <h3>{t("landing2.v2.lock.prev")}</h3>
              <div className="lp-states">
                <p className="lp-pill lp-pill--hold lp-st-a"><Icon name="key" size={16} />{t("landing2.v2.lock.holds")}</p>
                <p className="lp-pill lp-pill--red lp-st-b"><Icon name="x" size={16} />{t("landing2.v2.lock.refused")}</p>
              </div>
              <code className="lp-code">{t("landing2.v2.lock.code")}</code>
            </article>
            <div className="lp-lock-arrow" aria-hidden="true">
              <svg viewBox="0 0 64 24" focusable="false"><path d="M2 12h56M46 3l12 9-12 9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="lp-lock-key" src="/heirloom/keys/k03.webp" alt="" width={433} height={1077} loading="lazy" decoding="async" />
            </div>
            <article className="lp-holder lp-holder--next" data-testid="lock-right">
              <span className="lp-tint" aria-hidden="true" />
              <Icon name="user" size={40} className="lp-holder-ico" />
              <h3>{t("landing2.v2.lock.next")}</h3>
              <div className="lp-states">
                <p className="lp-pill lp-pill--hold lp-st-a">{t("landing2.v2.lock.waiting")}</p>
                <p className="lp-pill lp-pill--green lp-st-b"><Icon name="check" size={16} />{t("landing2.v2.lock.granted")}</p>
              </div>
              <span className="lp-code lp-code--ghost" aria-hidden="true">&nbsp;</span>
            </article>
          </div>
          <LoopControl className="lp-lock-ctl" paused={loop.paused} onToggle={loop.toggle} pauseLabel={t("landing2.v2.lock.pause")} playLabel={t("landing2.v2.lock.play")} />
        </div>
      </div>
    </section>
  );
}
