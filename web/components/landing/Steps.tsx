"use client";
/**
 * How it works: three cream cards (mint, use, transfer) joined by brass chevrons. Dealt moment 1: when the section first enters the
 * view, the chevrons draw and the three numbers pop once (CSS, off under reduced motion). The mint card shows the REAL Bronze
 * FoilCard that /mint previews, turned -6 degrees; the foil sheen runs on hover.
 */
import { useRef } from "react";
import { KeyArt } from "@/components/Art";
import { FoilCard } from "@/components/FoilCard";
import { useI18n } from "@/lib/i18n";
import { useDealt } from "../LandingMotion";
import { Icon } from "./icons";

function Chevron() {
  return (
    <svg className="lp-chev" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <path d="m6 6 8 8-8 8M14 6l8 8-8 8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
    </svg>
  );
}

/** The mint card's picture: the Bronze foil card as /mint shows it, drawn at 200 px wide and scaled down as one piece. */
function MintCard({ alt }: { alt: string }) {
  return (
    <div className="lp-s1" aria-hidden="true">
      <div className="lp-s1-fit">
        <FoilCard finish="Bronze" className="lp-s1-card">
          <div className="top"><span className="tier">Bronze</span><span className="oo">Mintable</span></div>
          <div className="art"><KeyArt n={3} alt={alt} width={430} height={1080} /></div>
        </FoilCard>
      </div>
    </div>
  );
}

/** The use card's picture: three stacked emerald mini cards, a brass candlestick sketch (decorative, no numbers) and a lock badge. */
function UseCards() {
  const candles = [[6, 20, 10, "g"], [14, 14, 14, "g"], [22, 18, 8, "r"], [30, 10, 14, "g"], [38, 12, 8, "r"], [46, 6, 12, "g"]] as const;
  return (
    <div className="lp-s2" aria-hidden="true">
      <span className="lp-mini lp-mini--3" /><span className="lp-mini lp-mini--2" />
      <span className="lp-mini lp-mini--1">
        <svg viewBox="0 0 56 32" className="lp-candles" focusable="false">
          <path d="M2 28c10-2 14-6 22-12s16-6 30-12" fill="none" stroke="#F3D27A" strokeWidth="1" strokeOpacity=".55" />
          {candles.map(([x, y, h, c], i) => (
            <g key={i}>
              <path d={`M${x} ${y - 4}v${h + 8}`} stroke={c === "g" ? "#7FD6A5" : "#F3D27A"} strokeWidth="1" />
              <rect x={x - 2.2} y={y} width="4.4" height={h} rx=".8" fill={c === "g" ? "#3BBF7E" : "#D9B26A"} />
            </g>
          ))}
        </svg>
        <span className="lp-badge-lock"><Icon name="lock" size={14} /></span>
      </span>
    </div>
  );
}

/** The transfer card's picture: two round holder badges and the arrows between them. */
function Holders({ a, b }: { a: string; b: string }) {
  return (
    <div className="lp-s3" role="img" aria-label={`${a}, then ${b}`}>
      <span className="lp-avatar lp-avatar--a"><Icon name="user" size={30} /></span>
      <Icon name="swap" size={26} className="lp-s3-arrows" />
      <span className="lp-avatar lp-avatar--b"><Icon name="user" size={30} /></span>
    </div>
  );
}

export function Steps() {
  const { t } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const dealt = useDealt(ref, 0.3);
  const cards = [
    { n: 1, title: "landing2.v2.how.s1t", body: "landing2.v2.how.s1d", art: <MintCard alt={t("landing2.v2.how.cardAlt")} /> },
    { n: 2, title: "landing2.v2.how.s2t", body: "landing2.v2.how.s2d", art: <UseCards /> },
    { n: 3, title: "landing2.v2.how.s3t", body: "landing2.v2.how.s3d", art: <Holders a={t("landing2.v2.how.holderA")} b={t("landing2.v2.how.holderB")} /> },
  ];
  return (
    <section className="lp-sec lp-how" id="handover" aria-labelledby="how-h" ref={ref} data-dealt={dealt}>
      <div className="lp-wrap">
        <header className="lp-head">
          <p className="lp-eyebrow lp-eyebrow--centre">{t("landing2.v2.how.eyebrow")}</p>
          <h2 id="how-h" className="lp-h2 lp-h2--centre">{t("landing2.v2.how.h2")}</h2>
        </header>
        <ol className="lp-steps">
          {cards.map((c, i) => (
            <li key={c.n} className="lp-steps-li">
              <article className="lp-card lp-step" style={{ "--i": i } as React.CSSProperties}>
                <h3><span className="lp-disc" style={{ "--i": i } as React.CSSProperties}>{c.n}</span>{t(c.title)}</h3>
                <p>{t(c.body)}</p>
                <div className="lp-step-art">{c.art}</div>
              </article>
              {i < cards.length - 1 && <span className="lp-chev-wrap" style={{ "--i": i } as React.CSSProperties}><Chevron /></span>}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
