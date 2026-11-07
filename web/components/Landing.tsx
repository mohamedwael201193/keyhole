"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { HomeMotion } from "./HomeMotion";
import { Cipher } from "./Cipher";
import { Icon, KeyArt, Scene } from "./Art";
import { FoilCard } from "./FoilCard";
import { HeroDust } from "./HeroDust";
import { CHAINS, Medal } from "./Medal";
import { KeyCard } from "./KeyCard";
import { TxLink } from "@/components/TxLink";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CountUp, FadeUp, GlowReveal, Parallax, Stagger, Tilt } from "@/components/motion";
import { useI18n } from "@/lib/i18n";
import { KEYS_CONTRACT, WORKER_PUBLISH_TX, WORKER_WASM_SHA256 } from "@/lib/config";
import { formatTradePrice } from "@/lib/price";
import { CAPS, CATALOG, type Finish } from "@/lib/traits";
import { TXS } from "@/lib/evidence";
import { SETTLEMENTS } from "@/lib/settlements";
import type { Config, Token } from "@/lib/near";

const ORBIT = CHAINS.map(([id, name], i) => {
  const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
  return { id, name, left: (50 + 44 * Math.cos(a)).toFixed(1), top: (50 + 44 * Math.sin(a)).toFixed(1) };
});

/** Finishes shown as labelled previews only. Silver and Gold are not mintable today (README: only Bronze). */
const PREVIEWS: { name: Finish; art: number }[] = [{ name: "Silver", art: 4 }, { name: "Gold", art: 2 }];

/** The browser checks on /verify (TOTAL_CHECKS in app/verify/view.tsx). */
const BROWSER_CHECKS = 37;

/** Chains named by the evidence file's order labels (lib/settlements.ts). */
const SETTLED_CHAINS = ["NEAR", "Base", "Solana"].filter((c) => SETTLEMENTS.some((s) => s.label.includes(c)));

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

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M5 12.5l4.2 4.2L19 7.5" />
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

export function Landing({ supply, hash, config, tokens, tiers }: {
  supply: number | null; hash: string; config: Config | null; tokens: Token[]; tiers: (number | null)[];
}) {
  const { t } = useI18n();
  const tr = (name: string) => { const v = t(`traits.${name}`); return v.startsWith("traits.") ? name : v; };
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

      {/* 1. Hero: the hero key and orbit are unchanged; only the text column is new. */}
      <section className="hero lp-hero" id="s01">
        <HeroDust />
        <div className="lp-hero-copy">
          <h1 className="hero-line">{t("land.h1a")}<em>{t("land.h1b")}</em></h1>
          <p className="lead">{t("land.lead")}</p>
          <div className="lp-cta">
            <Button href="/start" size="lg" testid="start-cta">{t("land.start")}</Button>
            <Button href="/mint" size="lg" variant="secondary">{t("land.mint")}</Button>
          </div>
          <p className="lp-links">
            <Link href="/verify" className="lp-link">{t("land.verify")}</Link>
            <Link href="/judge" className="lp-link" data-testid="judge-cta">{t("land.judgeCta")} →</Link>
          </p>
          <p className="lp-meta">{t("land.eyebrow")}</p>
        </div>
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
        <div className="beats">
          <p className="lp-moves">{t("land.moves")}</p>
          {(["I", "II", "III"] as const).map((n, i) => (
            <div className="beat" key={n}><i>{n}</i><div><h2>{t(`land.b${i + 1}t`)}</h2><p>{t(`land.b${i + 1}d`)}</p></div></div>
          ))}
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

      {/* 3. Four features, drawn line icons, no boxes. */}
      <section className="lp-sec" aria-labelledby="feat-h">
        <FadeUp className="lp-wrap">
          <h2 id="feat-h" className="lp-h2">{t("land.featH")}</h2>
        </FadeUp>
        <Stagger className="lp-wrap lp-features" gap={0.1}>
          <article><LineIcon name="loop" /><h3>{t("land.feat1t")}</h3><p>{t("land.feat1d")}</p></article>
          <article><LineIcon name="lock" /><h3>{t("land.feat2t")}</h3><p>{t("land.feat2d")}</p></article>
          <article><LineIcon name="route" /><h3>{t("land.feat3t")}</h3><p>{t("land.feat3d")}</p></article>
          <article><LineIcon name="key" /><h3>{t("land.feat4t")}</h3><p>{t("land.feat4d")}</p></article>
        </Stagger>
      </section>

      {/* 4. How it works: the three steps and the sealed-credentials line. */}
      <section className="lp-sec" aria-labelledby="how-h">
        <FadeUp className="lp-wrap">
          <h2 id="how-h" className="lp-h2">{t("land.howH")}<em>{t("land.howEm")}</em>{t("land.howAfter")}</h2>
          <Stagger className="lp-steps" gap={0.12}>
            {[{ icon: 1, k: "st1" }, { icon: 2, k: "st2" }, { icon: 5, k: "st3" }].map((s) => (
              <div className="lp-step" key={s.k}>
                <Icon n={s.icon} className="lp-step-art" />
                <h3>{t(`land.${s.k}t`)}</h3>
                <p>{t(`land.${s.k}d`)}</p>
              </div>
            ))}
          </Stagger>
          <p className="lp-sealed" data-testid="sealed-line"><b>{t("land.sealedB")}</b> {t("land.sealedD")} <Link href="/judge" className="lp-link">{t("land.sealedLink")}</Link></p>
        </FadeUp>
      </section>

      {/* 5. Private vault: public ownership on one side, the sealed book on the other. */}
      <section className="lp-sec" aria-labelledby="priv-h">
        <div className="lp-wrap lp-split">
          <Parallax className="lp-art" speed={0.1}>
            <img className="lp-img" src="/heirloom/privacy-chain.webp" alt={t("land.privAlt")} width={640} height={480} loading="lazy" decoding="async" />
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

      {/* 6. The key with utility: the chest art and the four guardrails, as checks. */}
      <section className="lp-sec lp-rev" aria-labelledby="util-h">
        <div className="lp-wrap lp-split">
          <Parallax className="lp-art" speed={0.1}>
            <img className="lp-img" src="/heirloom/privacy-chest.webp" alt="" width={640} height={480} loading="lazy" decoding="async" />
          </Parallax>
          <FadeUp>
            <h2 id="util-h" className="lp-h2">{t("land.utilH")}</h2>
            <p className="lp-lead">{t("land.utilLead")}</p>
            <Stagger className="lp-checks" gap={0.1}>
              {(["cap", "sig", "replay", "rate"] as const).map((k) => (
                <div className="lp-check" key={k}>
                  <span className="lp-check-ico"><CheckIcon /></span>
                  <div>
                    <h3>{t(`land.${k}H`)}</h3>
                    <p>{t(`land.${k}D`)}</p>
                    <p className="lp-num">{t(`land.${k}N`)}</p>
                  </div>
                </div>
              ))}
            </Stagger>
          </FadeUp>
        </div>
      </section>

      {/* 7. Enclave: the attestation card keeps its structure; the glow settles in once. */}
      <section className="lp-sec" aria-labelledby="encl-h">
        <div className="lp-wrap lp-split">
          <Parallax className="lp-art" speed={0.1}>
            <Scene name="enclave" className="lp-img" alt={t("land.enclAlt")} width={1152} height={864} />
          </Parallax>
          <FadeUp>
            <h2 id="encl-h" className="lp-h2">{t("land.enclH")}<em>{t("land.enclEm")}</em></h2>
            <p className="lp-lead">{t("land.enclLead")}</p>
            <GlowReveal className="lp-glow">
              <Card size="lg" className="attc">
                <span className="att">{t("land.attested")}</span>
                <dl className="kv">
                  <dt>{t("land.worker")}</dt><dd className="mono" data-kind="hash">{WORKER_WASM_SHA256[0]}</dd>
                  <dt>{t("land.tx")}</dt><dd className="mono" data-kind="hash"><TxLink hash={WORKER_PUBLISH_TX}>{WORKER_PUBLISH_TX}</TxLink></dd>
                  <dt>{t("land.runtime")}</dt><dd>OutLayer · wasm32-wasip2</dd>
                </dl>
                <Button href="/verify" variant="primary">{t("land.verifySelf")}</Button>
              </Card>
            </GlowReveal>
          </FadeUp>
        </div>
      </section>

      {/* 8. Collection: real tokens from the contract, then labelled previews. */}
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
          <p className="lp-note">{t("land.legDaily")}</p>
          <p className="lp-links"><Link href="/gallery" className="lp-link" data-testid="gallery-link">{t("land.browseAll")} →</Link></p>

          <p className="lp-note" data-testid="concept-banner"><b>{t("land.concept")}</b> <Link href="/gallery" className="lp-link">{t("land.conceptLive")} →</Link></p>
          <details className="lp-more">
            <summary>{t("land.moreDesigns")}</summary>
            <div className="gg">
              {CATALOG.map((k) => (
                <article className="gk" key={k.n}>
                  <FoilCard finish={k.finish}>
                    <div className="top">
                      <span className="tier">{t(`finish.${k.finish}`)}</span>
                      <span className="oo">{t("land.oneOfOne")}</span>
                    </div>
                    <div className="art"><KeyArt n={k.n} alt={t("land.catN", { n: k.n })} width={430} height={1080} /></div>
                    <h3>{t("land.catN", { n: k.n })}</h3>
                    <div className="meta">
                      <span>{t("land.cipherN", { n: k.n })}</span>
                      <span>{formatTradePrice(CAPS[k.finish].perTx)}</span>
                    </div>
                  </FoilCard>
                  <dl>
                    <dt>{t("field.head")}</dt><dd>{tr(k.head)}</dd>
                    <dt>{t("field.filigree")}</dt><dd>{tr(k.filigree)}</dd>
                    <dt>{t("field.enamel")}</dt><dd>{tr(k.enamel)}</dd>
                    <dt>{t("field.gem")}</dt><dd>{tr(k.gem)}</dd>
                    <dt>{t("field.shaft")}</dt><dd>{tr(k.shaft)}</dd>
                  </dl>
                  <div className="cbar"><span>{t("land.cipherN", { n: k.n })}</span><Cipher bits={k.n.toString(2).padStart(8, "0")} /></div>
                </article>
              ))}
            </div>
          </details>
        </div>
      </section>

      {/* 9. For agents: the signed-call example, unchanged. */}
      <section className="lp-sec" aria-labelledby="ag-h">
        <div className="lp-wrap lp-split">
          <FadeUp>
            <h2 id="ag-h" className="lp-h2">{t("land.agH")}<em>{t("land.agEm")}</em></h2>
            <p className="lp-lead">{t("land.agLead")}</p>
            <div className="ops">{["info", "status", "quote", "mint", "account", "balance", "swap", "copy", "withdraw", "history"].map((op) => <span key={op}>{op}</span>)}</div>
          </FadeUp>
          <FadeUp delay={0.1}>
            <div className="term">
              <div className="bar"><i /><i /><i /></div>
              <span className="c">{t("land.termC")}</span><br />
              {"{"}<br />
              &nbsp;&nbsp;<span className="s">&quot;op&quot;</span>: &quot;quote&quot;,<br />
              &nbsp;&nbsp;<span className="s">&quot;account_id&quot;</span>: &quot;devmo.near&quot;,<br />
              &nbsp;&nbsp;<span className="s">&quot;ts_ms&quot;</span>: 1761600000000,<br />
              &nbsp;&nbsp;<span className="s">&quot;params&quot;</span>: {"{"} &quot;from&quot;: &quot;usdc&quot;, &quot;to&quot;: &quot;near&quot;, &quot;usd&quot;: 1 {"}"}<br />
              {"}"}<br />
              <span className="c">{t("land.termOut")}</span>
            </div>
          </FadeUp>
        </div>
      </section>

      {/* 10. Built for the NEAR ecosystem: dark green banner, chains, the real order count. */}
      <section className="lp-banner" aria-labelledby="near-h">
        <Parallax className="lp-banner-bg" speed={0.12}><div className="lp-banner-glow" /></Parallax>
        <div className="lp-wrap">
          <FadeUp>
            <h2 id="near-h">{t("land.nearH")}</h2>
            <p className="lp-lead">{t("land.chainLead")}</p>
            <p className="lp-links"><Link href="/settle" className="lp-link" data-testid="chain-settle">{t("land.chainTry")} →</Link></p>
          </FadeUp>
          <div className="lp-chains">
            {CHAINS.map(([id, name]) => (
              <div className="lp-chain" key={id}><Medal id={id} name={name} labeled={false} /><b>{name}</b></div>
            ))}
          </div>
          <p className="lp-note">{t("land.touch", { n: SETTLEMENTS.length, chains: SETTLED_CHAINS.join(", ") })}</p>
        </div>
      </section>

      {/* 11. Proof: every line is a mainnet transaction or the contract itself. */}
      <section className="lp-sec" aria-labelledby="proof-h">
        <div className="lp-wrap">
          <FadeUp>
            <h2 id="proof-h" className="lp-h2">{t("proof.title")}</h2>
            <p className="lp-lead">{t("proof.sub")}</p>
          </FadeUp>
          <FadeUp className="lp-proof">
            <ul>
              {TXS.map((x) => (
                <li key={x.hash}><span>{x.label}</span><TxLink hash={x.hash}>{x.hash.slice(0, 12)}…</TxLink></li>
              ))}
              <li><span>{KEYS_CONTRACT}</span><TxLink account={KEYS_CONTRACT}>{t("atlas.open")}</TxLink></li>
              {config && <li><span>{t("proof.beats")}</span><span className="mono">{config.beats}</span></li>}
              {config && <li><span>{t("proof.royalty")}</span><span className="mono">{config.royalty_bps / 100}%</span></li>}
            </ul>
          </FadeUp>
        </div>
      </section>

      {/* 12. Closing call to action and the rest of the app. */}
      <section className="lp-end" aria-labelledby="cta-h">
        <Parallax className="lp-keys-frame" speed={0.08}>
          <div className="lp-keys">
            <KeyArt n={5} alt="" width={415} height={1077} />
            <KeyArt n={7} alt="" width={469} height={1097} />
            <KeyArt n={9} alt="" width={496} height={1090} />
          </div>
        </Parallax>
        <FadeUp>
          <h2 id="cta-h">{t("land.ctaH")}<em>{t("land.ctaEm")}</em></h2>
          <div className="lp-cta lp-center">
            <Button href="/start" size="lg">{t("land.start")}</Button>
            <Button href="https://github.com/mohamedwael201193/keyhole#readme" variant="secondary" size="lg" target="_blank" rel="noreferrer">{t("land.docs")}</Button>
          </div>
          <nav className="lp-explore" aria-label={t("land.exploreLabel")}>
            <Link href="/ask" className="lp-link">{t("land.exAsk")}</Link>
            <Link href="/atlas" className="lp-link">{t("land.exAtlas")}</Link>
            <Link href="/identity" className="lp-link">{t("land.exIdentity")}</Link>
            <Link href="/source" className="lp-link">{t("land.exSource")}</Link>
          </nav>
        </FadeUp>
      </section>
    </div>
  );
}
