"use client";
import Link from "next/link";
import { HomeMotion } from "./HomeMotion";
import { KeyArt } from "./Art";
import { HeroDust } from "./HeroDust";
import { CHAINS, Medal } from "./Medal";
import { HeroIntro, HowMoment } from "./LandingMotion";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { CONTRACT_CODE_HASH, WORKER_WASM_SHA256 } from "@/lib/config";
import type { Token } from "@/lib/near";
import { KeyNow, SwapNow, TransferNow } from "./landing/Outcomes";
import { HowDiagram } from "./landing/HowDiagram";
import { ProofStrip } from "./landing/Proof";
import { Collection } from "./landing/Collection";

const ORBIT = CHAINS.map(([id, name], i) => {
  const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
  return { id, name, left: (50 + 44 * Math.cos(a)).toFixed(1), top: (50 + 44 * Math.sin(a)).toFixed(1) };
});

/** The browser checks on /verify (TOTAL_CHECKS in app/verify/view.tsx). */
const BROWSER_CHECKS = 37;

/** Short forms of the two build hashes, full value on hover. */
const WORKER_FULL = WORKER_WASM_SHA256[0];

export function Landing({ supply, hash, tokens, tiers }: {
  supply: number | null; hash: string; tokens: Token[]; tiers: (number | null)[];
}) {
  const { t } = useI18n();
  return (
    <div className="lp">
      <HomeMotion />

      {/* 1. Hero: the hero key and its orbit are unchanged (heirloom.css); the text reveals once on load (LandingMotion). */}
      <section className="hero lp-hero" id="top">
        <HeroDust />
        <HeroIntro className="lp-hero-copy">
          <h1 className="hero-line">
            <span className="lp-mask"><span className="lp-line">{t("land.h1a")}</span></span>
            <span className="lp-mask"><em className="lp-line">{t("land.h1b")}</em></span>
          </h1>
          <p className="lead lp-reveal">{t("land.lead")}</p>
          <div className="lp-cta lp-reveal">
            <Button href="/dashboard" size="lg" testid="start-cta">{t("home.launch")}</Button>
            <Button href="/verify" size="lg" variant="secondary">{t("home.checkProof")}</Button>
          </div>
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

      {/* 2. What you get: three outcomes, each drawn with real product UI from live data. */}
      <section className="lp-sec" id="outcomes" aria-labelledby="out-h">
        <div className="lp-wrap">
          <h2 id="out-h" className="lp-h2">{t("home.outH")}</h2>
          <div className="lp-outs">
            <article className="lp-out">
              <p className="lp-out-n mono" aria-hidden="true">01</p>
              <h3>{t("home.out1t")}</h3>
              <p>{t("home.out1d")}</p>
              <div className="lp-out-vis"><KeyNow token={tokens[0] ?? null} tier={tiers[0] ?? null} /></div>
            </article>
            <article className="lp-out">
              <p className="lp-out-n mono" aria-hidden="true">02</p>
              <h3>{t("home.out2t")}</h3>
              <p>{t("home.out2d")}</p>
              <div className="lp-out-vis"><SwapNow /></div>
            </article>
            <article className="lp-out">
              <p className="lp-out-n mono" aria-hidden="true">03</p>
              <h3>{t("home.out3t")}</h3>
              <p>{t("home.out3d")}</p>
              <div className="lp-out-vis"><TransferNow /></div>
            </article>
          </div>
        </div>
      </section>

      {/* 3. How a trade runs: the one dealt moment. Two screens tall; the diagram sticks inside it and the pulses run with the scroll. */}
      <HowMoment className="lp-how" labelledBy="how-h">
        <div className="lp-how-stick">
          <div className="lp-wrap">
            <h2 id="how-h" className="lp-h2">{t("home.howH")}</h2>
            <p className="lp-lead" data-testid="sealed-line"><b>{t("land.sealedB")}</b> {t("land.sealedD")} <Link href="/judge" className="lp-link">{t("land.sealedLink")}</Link></p>
            <HowDiagram />
          </div>
        </div>
      </HowMoment>

      {/* 4. Proof you can check: real numbers and a link to each way of checking. */}
      <section className="lp-sec" id="proof" aria-labelledby="proof-h">
        <div className="lp-wrap">
          <h2 id="proof-h" className="lp-h2">{t("home.proofH")}</h2>
          <p className="lp-lead">{t("home.proofLead")}</p>
          <ProofStrip
            checks={BROWSER_CHECKS}
            workerHash={hash}
            workerFull={WORKER_FULL}
            contractHash={CONTRACT_CODE_HASH.slice(0, 8)}
            contractFull={CONTRACT_CODE_HASH}
          />
        </div>
      </section>

      {/* 5. The collection: a grid of real keys, then the labelled previews. */}
      <section className="lp-sec" id="keys" aria-labelledby="keys-h">
        <div className="lp-wrap">
          <Collection supply={supply} tokens={tokens} tiers={tiers} />
        </div>
      </section>

      {/* 6. Final call to action on the vault surface. The key artwork is the picture. */}
      <section className="lp-end" id="cta" aria-labelledby="cta-h" data-dark>
        <div className="lp-keys" aria-hidden="true">
          <KeyArt n={5} alt="" width={415} height={1077} />
          <KeyArt n={7} alt="" width={469} height={1097} />
          <KeyArt n={9} alt="" width={496} height={1090} />
        </div>
        <h2 id="cta-h">{t("land.ctaH")}<em>{t("land.ctaEm")}</em></h2>
        <div className="lp-cta lp-center">
          <Button href="/dashboard" size="lg" variant="banner">{t("home.ctaLaunch")}</Button>
          <Button href="/settle" variant="ghost" className="lp-end-link" testid="chain-settle">{t("home.ctaSettle")} →</Button>
        </div>
      </section>
    </div>
  );
}
