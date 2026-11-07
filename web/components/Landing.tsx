"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { HomeMotion } from "./HomeMotion";
import { Icon, KeyArt, Scene } from "./Art";
import { FoilCard } from "./FoilCard";
import { HeroDust } from "./HeroDust";
import { CHAINS, Medal } from "./Medal";
import { KeyCard } from "./KeyCard";
import { HeroIntro, HowPin } from "./LandingMotion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CountUp, FadeUp, GlowReveal, Parallax, Stagger, Tilt } from "@/components/motion";
import { useI18n } from "@/lib/i18n";
import { WORKER_PUBLISH_TX, WORKER_WASM_SHA256 } from "@/lib/config";
import { formatTradePrice } from "@/lib/price";
import { CAPS, type Finish } from "@/lib/traits";
import { SETTLEMENTS } from "@/lib/settlements";
import { TxLink } from "@/components/TxLink";
import type { Token } from "@/lib/near";

const ORBIT = CHAINS.map(([id, name], i) => {
  const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
  return { id, name, left: (50 + 44 * Math.cos(a)).toFixed(1), top: (50 + 44 * Math.sin(a)).toFixed(1) };
});

/** Finishes shown as labelled previews only. Silver and Gold are not mintable today (README: only Bronze). */
const PREVIEWS: { name: Finish; art: number }[] = [{ name: "Silver", art: 4 }, { name: "Gold", art: 2 }];

/** The browser checks on /verify (TOTAL_CHECKS in app/verify/view.tsx). */
const BROWSER_CHECKS = 37;

const HOW_STEPS = [
  { icon: 1, k: "st1" },
  { icon: 2, k: "st2" },
  { icon: 5, k: "st3" },
] as const;

/** Chains named by the evidence file's order labels (lib/settlements.ts). */
const SETTLED_CHAINS = ["NEAR", "Base", "Solana"].filter((c) => SETTLEMENTS.some((s) => s.label.includes(c)));

const FEATURES = [
  { icon: "loop", k: "feat1" },
  { icon: "lock", k: "feat2" },
  { icon: "route", k: "feat3" },
  { icon: "key", k: "feat4" },
] as const;

const LINE_ICONS: Record<"loop" | "lock" | "route" | "key", ReactNode> = {
  loop: <><path d="M19.5 9A8 8 0 0 0 5.2 7.1" /><path d="M4.5 15a8 8 0 0 0 14.3 1.9" /><path d="M19.5 4.5V9h-4.5" /><path d="M4.5 19.5V15H9" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  route: <><path d="M4 8h12l-3-3" /><path d="M20 16H8l3 3" /></>,
  key: <><circle cx="8" cy="12" r="3.5" /><path d="M11.5 12H21" /><path d="M18 12v3.5" /><path d="M21 12v2.5" /></>,
};

function LineIcon({ name }: { name: keyof typeof LINE_ICONS }) {
  return (
    <svg className="lp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {LINE_ICONS[name]}
    </svg>
  );
}

function ChevronIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={dir === "left" ? "M14.5 6l-6 6 6 6" : "M9.5 6l6 6-6 6"} />
    </svg>
  );
}

function SupplyStat({ initial }: { initial: number | null }) {
  const [n, setN] = useState(initial);
  useEffect(() => {
    if (initial != null) return;
    let cancel = false;
    const tick = () => fetch("/api/supply").then((r) => r.json()).then((j) => {
      if (!cancel && Number.isInteger(j?.supply)) setN(j.supply);
    }).catch(() => {});
    tick();
    const id = window.setInterval(tick, 3_000);
    const stop = window.setTimeout(() => window.clearInterval(id), 12_000);
    return () => { cancel = true; window.clearInterval(id); window.clearTimeout(stop); };
  }, [initial]);
  return <span data-testid="supply">{n == null ? "—" : n}</span>;
}

export function Landing({ supply, hash, tokens, tiers }: {
  supply: number | null; hash: string; tokens: Token[]; tiers: (number | null)[];
}) {
  const { t } = useI18n();
  const track = useRef<HTMLDivElement>(null);

  function slide(dir: 1 | -1) {
    const el = track.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.8), behavior: reduce ? "auto" : "smooth" });
  }

  return (
    <div className="lp">
      <HomeMotion />

      {/* 1. Hero: the hero key and its orbit are unchanged; the text reveals on load (components/LandingMotion.tsx). */}
      <section className="hero lp-hero" id="s01">
        <HeroDust />
        <HeroIntro className="lp-hero-copy">
          <h1 className="hero-line">
            <span className="lp-mask"><span className="lp-line">{t("land.h1a")}</span></span>
            <span className="lp-mask"><em className="lp-line">{t("land.h1b")}</em></span>
          </h1>
          <p className="lead lp-reveal">{t("land.lead")}</p>
          <div className="lp-cta lp-reveal">
            <Button href="/start" size="lg" testid="start-cta" className="lp-sweep">{t("land.start")}</Button>
            <Button href="/mint" size="lg" variant="secondary">{t("land.mint")}</Button>
          </div>
          <p className="lp-links lp-reveal">
            <Link href="/judge" className="lp-link" data-testid="judge-cta">{t("land.judgeCta")} →</Link>
            <Link href="/verify" className="lp-link">{t("land.verify")}</Link>
          </p>
          <p className="lp-meta lp-reveal">{t("land.eyebrow")}</p>
        </HeroIntro>
        <div className="stage-slot">
          <div className="stage">
            <svg className="kh-ring" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
              <defs><path id="ringpath" d="M200,200 m-150,0 a150,150 0 1,1 300,0 a150,150 0 1,1 -300,0" /></defs>
              <text textLength={930} lengthAdjust="spacing">
                <textPath href="#ringpath">{t("land.ring")}</textPath>
              </text>
            </svg>
            <div className="orbit">
              {ORBIT.map((c) => (
                <div className="m" key={c.id} style={{ left: `${c.left}%`, top: `${c.top}%` }}>
                  <div className="m-in"><Medal id={c.id} name={c.name} /><b>{c.name}</b></div>
                </div>
              ))}
            </div>
            <KeyArt n={1} alt={t("land.keyAlt", { n: 1 })} className="hkey" priority width={437} height={1084} />
          </div>
        </div>
      </section>

      {/* 2. Live numbers: each one is read from mainnet, the build, the browser checks or the evidence file. */}
      <section className="lp-sec lp-strip" aria-label={t("land.liveLabel")}>
        <FadeUp className="lp-wrap">
          <dl className="lp-stats">
            <div><dt>{t("land.s1")}</dt><dd><SupplyStat initial={supply} /></dd></div>
            <div><dt>{t("land.s2")}</dt><dd><Link href="/verify" className="lp-statlink" data-testid="checks-stat"><CountUp value={BROWSER_CHECKS} /></Link></dd></div>
            <div><dt>{t("land.s3")}</dt><dd><Link href="/judge" className="lp-statlink lp-mono" data-testid="hash-stat" title="See this build checked step by step">{hash}</Link></dd></div>
            <div><dt>{t("land.s4")}</dt><dd><CountUp value={SETTLEMENTS.length} testid="orders-stat" /></dd></div>
          </dl>
        </FadeUp>
      </section>

      {/* 3. How it works: three steps. Desktop pins the section and lights each step as you scroll; phones stack them. */}
      <HowPin className="lp-sec lp-how" labelledBy="how-h">
        <div className="lp-wrap lp-how-inner">
          <FadeUp>
            <h2 id="how-h" className="lp-h2">{t("land.howH")}<em>{t("land.howEm")}</em>{t("land.howAfter")}</h2>
          </FadeUp>
          <div className="lp-steps">
            {HOW_STEPS.map((s) => (
              <div className="lp-step" key={s.k}>
                <Icon n={s.icon} className="lp-step-art" />
                <h3>{t(`land.${s.k}t`)}</h3>
                <p>{t(`land.${s.k}d`)}</p>
              </div>
            ))}
          </div>
          <div className="lp-how-track" aria-hidden="true"><i className="lp-how-bar" /></div>
          <p className="lp-sealed" data-testid="sealed-line"><b>{t("land.sealedB")}</b> {t("land.sealedD")} <Link href="/judge" className="lp-link">{t("land.sealedLink")}</Link></p>
        </div>
      </HowPin>

      {/* 4. What one key does: four features, drawn line icons, no boxes. */}
      <section className="lp-sec" aria-labelledby="feat-h">
        <FadeUp className="lp-wrap">
          <h2 id="feat-h" className="lp-h2">{t("land.featH")}</h2>
        </FadeUp>
        <Stagger className="lp-wrap lp-features" gap={0.1}>
          {FEATURES.map((f) => (
            <article key={f.k}><LineIcon name={f.icon} /><h3>{t(`land.${f.k}t`)}</h3><p>{t(`land.${f.k}d`)}</p></article>
          ))}
        </Stagger>
      </section>

      {/* 5. Private vault: the sealed enamel chest (the one heirloom image on this page) and two points. */}
      <section className="lp-sec" aria-labelledby="priv-h">
        <div className="lp-wrap lp-split">
          <Parallax className="lp-art" speed={0.1}>
            <Scene name="enclave" className="lp-img" alt={t("land.privAlt")} width={1152} height={864} />
          </Parallax>
          <FadeUp>
            <h2 id="priv-h" className="lp-h2">{t("land.privH")}<em>{t("land.privEm")}</em></h2>
            <p className="lp-lead">{t("land.privLead")}</p>
            <div className="lp-two">
              <div><h3>{t("land.pubH")}</h3><p>{t("land.pubD")}</p></div>
              <div><h3>{t("land.sealH")}</h3><p>{t("land.sealD")}</p></div>
            </div>
          </FadeUp>
        </div>
      </section>

      {/* 6. Proof you can check: the attestation card and the two ways to check it. */}
      <section className="lp-sec" aria-labelledby="encl-h">
        <div className="lp-wrap lp-split">
          <FadeUp>
            <h2 id="encl-h" className="lp-h2">{t("land.enclH")}<em>{t("land.enclEm")}</em></h2>
            <p className="lp-lead">{t("land.enclLead")}</p>
            <div className="lp-cta">
              <Button href="/verify" variant="primary" testid="verify-cta">{t("land.verifySelf")}</Button>
              <Button href="/judge" variant="secondary">{t("land.judgeCta")}</Button>
            </div>
          </FadeUp>
          <GlowReveal className="lp-glow">
            <Card size="lg" className="attc">
              <span className="att">{t("land.attested")}</span>
              <dl className="kv">
                <dt>{t("land.worker")}</dt><dd className="mono" data-kind="hash">{WORKER_WASM_SHA256[0]}</dd>
                <dt>{t("land.tx")}</dt><dd className="mono" data-kind="hash"><TxLink hash={WORKER_PUBLISH_TX}>{WORKER_PUBLISH_TX}</TxLink></dd>
                <dt>{t("land.runtime")}</dt><dd>OutLayer · wasm32-wasip2</dd>
              </dl>
            </Card>
          </GlowReveal>
        </div>
      </section>

      {/* 7. Collection: real keys from the contract, then labelled previews. */}
      <section className="lp-sec" aria-labelledby="gal-h">
        <div className="lp-wrap">
          <FadeUp className="lp-gal-head">
            <div>
              <h2 id="gal-h" className="lp-h2">{t("land.galH")}<em>{t("land.galEm")}</em></h2>
              <p className="lp-lead">{t("land.galLead")}</p>
            </div>
            <div className="lp-track-nav">
              <Button variant="secondary" size="sm" aria-label={t("land.prev")} onClick={() => slide(-1)}><ChevronIcon dir="left" /></Button>
              <Button variant="secondary" size="sm" aria-label={t("land.next")} onClick={() => slide(1)}><ChevronIcon dir="right" /></Button>
            </div>
          </FadeUp>
          <div className="lp-track" ref={track} role="region" tabIndex={0} aria-label={t("land.galH")}>
            {tokens.length === 0 && <p className="lp-empty">{t("land.noKeys")}</p>}
            {tokens.map((tok, i) => (
              <div className="lp-slide" key={tok.token_id}>
                <Tilt><KeyCard token={tok} tier={tiers[i] ?? null} viewer={null} displayIndex={i + 1} /></Tilt>
              </div>
            ))}
            {PREVIEWS.map((p) => (
              <div className="lp-slide" key={p.name}>
                <Tilt>
                  <article className="gk lp-prev">
                    <p className="lp-preview">{t("land.previewLabel")}</p>
                    <FoilCard finish={p.name}>
                      <div className="top"><span className="tier">{t(`finish.${p.name}`)}</span></div>
                      <div className="art"><KeyArt n={p.art} alt={t(`finish.${p.name}`)} width={430} height={1080} /></div>
                      <h3>{t("land.keyN", { n: p.art })}</h3>
                      <div className="meta">
                        <span>{t("land.cipherN", { n: p.art })}</span>
                        <span>{formatTradePrice(CAPS[p.name].perTx)}</span>
                      </div>
                    </FoilCard>
                  </article>
                </Tilt>
              </div>
            ))}
          </div>
          <p className="lp-note" data-testid="tier-note">{t("land.tierLead")}</p>
          <p className="lp-note" data-testid="concept-banner"><b>{t("land.concept")}</b> <Link href="/gallery" className="lp-link">{t("land.conceptLive")} →</Link></p>
          <p className="lp-links"><Link href="/gallery" className="lp-link" data-testid="gallery-link">{t("land.browseAll")} →</Link></p>
        </div>
      </section>

      {/* 8. Final call to action on the NEAR banner. Keys are artwork; the touch line is a real count from the evidence file. */}
      <section className="lp-banner lp-end" aria-labelledby="cta-h" data-dark>
        <Parallax className="lp-keys-frame" speed={0.08}>
          <div className="lp-keys">
            <KeyArt n={5} alt="" width={415} height={1077} />
            <KeyArt n={7} alt="" width={469} height={1097} />
            <KeyArt n={9} alt="" width={496} height={1090} />
          </div>
        </Parallax>
        <FadeUp>
          <p className="lp-eyebrow">{t("land.nearH")}</p>
          <h2 id="cta-h">{t("land.ctaH")}<em>{t("land.ctaEm")}</em></h2>
          <p className="lp-note lp-center">{t("land.touch", { n: SETTLEMENTS.length, chains: SETTLED_CHAINS.join(", ") })}</p>
          <div className="lp-cta lp-center">
            <Button href="/start" size="lg" variant="banner" className="lp-sweep">{t("land.start")}</Button>
            <Button href="/mint" size="lg" variant="secondary">{t("land.mint")}</Button>
          </div>
          <p className="lp-links lp-center"><Link href="/settle" className="lp-link lp-link-light" data-testid="chain-settle">{t("land.chainTry")} →</Link></p>
        </FadeUp>
      </section>
    </div>
  );
}
