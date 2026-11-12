"use client";
import Link from "next/link";
import { HomeMotion } from "./HomeMotion";
import { KeyArt } from "./Art";
import { HeroDust } from "./HeroDust";
import { CHAINS, Medal } from "./Medal";
import { HeroIntro, HandoverMoment } from "./LandingMotion";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/motion";
import { useI18n } from "@/lib/i18n";
import { publicOrderCensus } from "@/lib/settlements";
import { siteUrl } from "@/lib/site";
import { IDENTITY } from "@/lib/identity.gen";
import type { TokenReach } from "@/lib/landing";
import { ProofStrip } from "./landing/Proof";
import { LiveStats } from "./landing/LiveStats";
import { Handover } from "./landing/Handover";
import { BuyerCheck } from "./landing/BuyerCheck";
import { Reach } from "./landing/Reach";

const ORBIT = CHAINS.map(([id, name], i) => {
  const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
  return { id, name, left: (50 + 44 * Math.cos(a)).toFixed(1), top: (50 + 44 * Math.sin(a)).toFixed(1) };
});

/** The browser checks on /verify (TOTAL_CHECKS in app/verify/view.tsx). */
const BROWSER_CHECKS = 37;

/** Immutable checkout of the pinned source commit. The README generates the same steps. */
const CMD_CLONE = `git init keyhole && cd keyhole && git remote add origin https://github.com/mohamedwael201193/keyhole.git && git fetch --depth 1 origin ${IDENTITY.review.source_commit} && git checkout --detach FETCH_HEAD`;
const CMD_VERIFY = "node judge/verify-claims.mjs";
const SITE = siteUrl();

export function Landing({ supply, hash, reach }: { supply: number | null; hash: string; reach: TokenReach | null }) {
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
            <Button href="/try?start=1" size="lg" variant="secondary" testid="try-free-cta">Try it free — testnet</Button>
            <Button href="#handover" size="lg" variant="secondary" testid="handover-cta">{t("lp.watchHandover")}</Button>
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

      <LiveStats />

      {/* 2. Proof, not promises: four live numbers, each a link to where it is checked. */}
      <section className="lp-sec" id="proof" aria-labelledby="proof-h">
        <div className="lp-wrap">
          <h2 id="proof-h" className="lp-h2">{t("lp.proofH")}</h2>
          <p className="lp-lead">{t("lp.proofLead")}</p>
          <ProofStrip supply={supply} checks={BROWSER_CHECKS} hash={hash} orders={publicOrderCensus()} />
        </div>
      </section>

      {/* 3. The handover: the one dealt moment. Pinned on desktop, a plain stack elsewhere (LandingMotion.tsx). */}
      <HandoverMoment className="lp-sec lp-handover" id="handover" labelledBy="handover-h">
        <div className="lp-wrap">
          <h2 id="handover-h" className="lp-h2">{t("lp.handH")}</h2>
          <p className="lp-lead">{t("lp.handLead")}</p>
          <Handover />
          <p className="lp-note">{t("lp.handNote")}</p>
        </div>
      </HandoverMoment>

      {/* 4. Check a key before you buy it: the buyer panel, drawn with the /key styles and labelled as an example. */}
      <section className="lp-sec" id="check" aria-labelledby="check-h">
        <div className="lp-wrap">
          <BuyerCheck />
        </div>
      </section>

      {/* 5. Trade anything, from anywhere: the 1Click count and real token marks, read when the page renders. */}
      <section className="lp-sec" id="trade" aria-labelledby="trade-h">
        <div className="lp-wrap">
          <h2 id="trade-h" className="lp-h2">{t("lp.tradeH")}</h2>
          <Reach reach={reach} />
        </div>
      </section>

      {/* 6. Private by design: what the enclave sees and what anyone else sees. */}
      <section className="lp-sec" id="private" aria-labelledby="private-h">
        <div className="lp-wrap">
          <h2 id="private-h" className="lp-h2">{t("lp.privH")}</h2>
          <p className="lp-lead">{t("lp.privLead")}</p>
          <div className="priv-cols">
            <div className="priv-col" data-testid="sees-enclave">
              <h3>{t("lp.encT")}</h3>
              <ul>
                <li>{t("lp.enc1")}</li>
                <li>{t("lp.enc2")}</li>
                <li>{t("lp.enc3")}</li>
              </ul>
            </div>
            <div className="priv-col priv-col--public" data-testid="sees-public">
              <h3>{t("lp.pubT")}</h3>
              <ul>
                <li>{t("lp.pub1")}</li>
                <li>{t("lp.pub2")}</li>
                <li>{t("lp.pub3")}</li>
              </ul>
            </div>
          </div>
          <p className="priv-line">{t("lp.privLine")}</p>
          <div className="lp-cta">
            <Button href="/verify" variant="secondary">{t("lp.verifyCall")}</Button>
            <Button href="/attack" variant="secondary" testid="lp-attack">Try to steal a key</Button>
            <Link href="/ask" className="lp-link lp-cta-link">{t("lp.askLink")}</Link>
          </div>
        </div>
      </section>

      {/* 7. Verification path: three commands, each with a copy button. */}
      <section className="lp-sec" id="judge" aria-labelledby="judge-h">
        <div className="lp-wrap">
          <h2 id="judge-h" className="lp-h2">{t("lp.judgeH")}</h2>
          <p className="lp-lead">{t("lp.judgeLead")}</p>
          <div className="code-card" data-testid="judge-commands">
            <div className="code-row"><code>{CMD_CLONE}</code><CopyButton value={CMD_CLONE} /></div>
            <div className="code-row"><code>{CMD_VERIFY}</code><CopyButton value={CMD_VERIFY} /></div>
            <div className="code-row"><code>open /verify</code><CopyButton value={`${SITE}/verify`} /></div>
            <div className="code-row"><code>open /attack</code><CopyButton value={`${SITE}/attack`} /></div>
          </div>
        </div>
      </section>

      {/* 8. Final call to action on the vault surface. The key artwork is the picture. */}
      <section className="lp-end" id="cta" aria-labelledby="cta-h" data-dark>
        <div className="lp-keys" aria-hidden="true">
          <KeyArt n={5} alt="" width={415} height={1077} />
          <KeyArt n={7} alt="" width={469} height={1097} />
          <KeyArt n={9} alt="" width={496} height={1090} />
        </div>
        <h2 id="cta-h">{t("lp.ctaH")}</h2>
        <div className="lp-cta lp-center">
          <Button href="/dashboard" size="lg" variant="banner" testid="cta-get-key">{t("lp.getKey")}</Button>
          <Button href="/judge" variant="ghost" className="lp-end-link" testid="cta-proof">{t("lp.readProof")}</Button>
        </div>
      </section>
    </div>
  );
}
