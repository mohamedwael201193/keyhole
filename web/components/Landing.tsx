"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { HomeMotion } from "./HomeMotion";
import { Cipher } from "./Cipher";
import { Icon, KeyArt, Scene } from "./Art";
import { FoilCard } from "./FoilCard";
import { HeroDust } from "./HeroDust";
import { CHAINS, Medal } from "./Medal";
import { useI18n } from "@/lib/i18n";
import { KEYS_CONTRACT, WORKER_PUBLISH_TX, WORKER_WASM_SHA256, tx } from "@/lib/config";
import { formatTradePrice } from "@/lib/price";
import { CAPS, CATALOG, type Finish } from "@/lib/traits";
import { TXS } from "@/lib/evidence";
import type { Config } from "@/lib/near";

const ORBIT = CHAINS.map(([id, name], i) => {
  const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
  return { id, name, left: (50 + 44 * Math.cos(a)).toFixed(1), top: (50 + 44 * Math.sin(a)).toFixed(1) };
});

const TIERS: { name: Finish; art: number; daily: string }[] = [
  { name: "Bronze", art: 3, daily: "tierDaily" },
  { name: "Silver", art: 4, daily: "tierDaily" },
  { name: "Gold", art: 2, daily: "tierDaily" },
  { name: "Legendary", art: 1, daily: "legDaily" },
];

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
  return <dd data-testid="supply" data-count={n ?? undefined}>{n == null ? "—" : n}</dd>;
}

export function Landing({ supply, hash, config }: { supply: number | null; hash: string; config: Config | null }) {
  const { t } = useI18n();
  const tr = (name: string) => { const v = t(`traits.${name}`); return v.startsWith("traits.") ? name : v; };
  return (
    <>
      <HomeMotion />
      <section className="hero" id="s01">
        <HeroDust />
        <div>
          <p className="eb hero-line">{t("land.eyebrow")}</p>
          <h1 className="hero-line">{t("land.h1a")}<em>{t("land.h1b")}</em></h1>
          <p className="lead">{t("land.lead")}</p>
          <div className="hero-actions">
            <Link className="btn b1" href="/mint">{t("land.mint")}</Link>
            <Link className="btn b2" href="/verify">{t("land.verify")}</Link>
          </div>
          <dl className="stats">
            <div><SupplyStat initial={supply} /><dt>{t("land.s1")}</dt></div>
            <div><dd>$<span data-count="1" data-dec="2">1.00</span></dd><dt>{t("land.s2")}</dt></div>
            <div><dd className="h">{hash}</dd><dt>{t("land.s3")}</dt></div>
          </dl>
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
          <p className="eb" style={{ marginBottom: 10 }}>{t("land.moves")}</p>
          {(["I", "II", "III"] as const).map((n, i) => (
            <div className="beat" key={n}><i>{n}</i><div><h2>{t(`land.b${i + 1}t`)}</h2><p>{t(`land.b${i + 1}d`)}</p></div></div>
          ))}
        </div>
      </section>

      <section className="sec story" id="s02">
        <div className="wrap" style={{ textAlign: "center" }}>
          <p className="eb">{t("land.howEyebrow")}</p>
          <h2 style={{ marginLeft: "auto", marginRight: "auto" }}>{t("land.howH")}<em>{t("land.howEm")}</em>{t("land.howAfter")}</h2>
          <div className="row">
            <svg className="line" viewBox="0 0 1328 80" preserveAspectRatio="none" aria-hidden="true">
              <path id="dl" d="M200,40 C420,-10 560,90 664,40 S 900,-10 1128,40" fill="none" stroke="#B8893E" strokeWidth="2.5" strokeDasharray="6 8" />
            </svg>
            {[{ icon: 1, k: "st1" }, { icon: 2, k: "st2" }, { icon: 5, k: "st3" }].map((s) => (
              <div className="st" key={s.k}><Icon n={s.icon} /><h3>{t(`land.${s.k}t`)}</h3><p>{t(`land.${s.k}d`)}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec priv" id="s03">
        <div className="wrap">
          <p className="eb">{t("land.privEyebrow")}</p>
          <h2>{t("land.privH")}<em>{t("land.privEm")}</em></h2>
          <p className="lead">{t("land.privLead")}</p>
          <div className="art">
            <Scene name="privacy" className="par" alt={t("land.privAlt")} width={1280} height={720} />
            <div className="lab l1"><p className="eb">{t("land.pubEyebrow")}</p><h3>{t("land.pubH")}</h3><p>{t("land.pubD")}</p></div>
            <div className="lab l2"><p className="eb">{t("land.sealEyebrow")}</p><h3>{t("land.sealH")}</h3><p>{t("land.sealD")}</p></div>
          </div>
        </div>
      </section>

      <section className="sec encl" id="s04">
        <div className="wrap g">
          <div className="ph"><Scene name="enclave" className="par" alt={t("land.enclAlt")} width={1152} height={864} /></div>
          <div>
            <p className="eb">{t("land.enclEyebrow")}</p>
            <h2>{t("land.enclH")}<em>{t("land.enclEm")}</em></h2>
            <p className="lead">{t("land.enclLead")}</p>
            <div className="card attc">
              <span className="att">{t("land.attested")}</span>
              <dl className="kv">
                <dt>{t("land.worker")}</dt><dd className="mono" data-kind="hash">{WORKER_WASM_SHA256[0]}</dd>
                <dt>{t("land.tx")}</dt><dd className="mono" data-kind="hash"><a href={tx(WORKER_PUBLISH_TX)} target="_blank" rel="noreferrer">{WORKER_PUBLISH_TX}</a></dd>
                <dt>{t("land.runtime")}</dt><dd>OutLayer · wasm32-wasip2</dd>
              </dl>
              <Link className="btn b1" href="/verify">{t("land.verifySelf")}</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="sec safe" id="s05">
        <div className="wrap">
          <p className="eb">{t("land.safeEyebrow")}</p>
          <h2>{t("land.safeH")}<em>{t("land.safeEm")}</em>{t("land.safeAfter")}</h2>
          <div className="g">
            {([[5, "cap"], [3, "sig"], [4, "replay"], [6, "rate"]] as const).map(([icon, k]) => (
              <div className="card" key={k}><Icon n={icon} /><h3>{t(`land.${k}H`)}</h3><p>{t(`land.${k}D`)}</p><p className="num">{t(`land.${k}N`)}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec chains" id="s06" data-dark>
        <div className="wrap">
          <p className="eb">{t("land.chainEyebrow")}</p>
          <h2>{t("land.chainH")}<em>{t("land.chainEm")}</em></h2>
          <p className="lead">{t("land.chainLead")}</p>
          <div className="cg">
            {CHAINS.map(([id, name]) => (
              <div className="c" key={id}><Medal id={id} name={name} labeled={false} /><b>{name}</b></div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec tiers" id="s07">
        <div className="wrap">
          <p className="eb">{t("land.tierEyebrow")}</p>
          <h2>{t("land.tierH")}<em>{t("land.tierEm")}</em></h2>
          <p className="lead">{t("land.tierLead")}</p>
          <div className="tg">
            {TIERS.map((tier) => (
              <div className="tc" key={tier.name}>
                <FoilCard finish={tier.name}>
                  <div className="top">
                    <span className="tier">{t(`finish.${tier.name}`)}</span>
                    <span className="oo">{t("land.oneOfOne")}</span>
                  </div>
                  <div className="art"><KeyArt n={tier.art} alt={t(`finish.${tier.name}`)} width={430} height={1080} /></div>
                  <h3>{t("land.keyN", { n: tier.art })}</h3>
                  <div className="meta">
                    <span>{t("land.cipherN", { n: tier.art })}</span>
                    <span>{formatTradePrice(CAPS[tier.name].perTx)}</span>
                  </div>
                </FoilCard>
                <p className="below">{tier.name === "Legendary" ? t("land.legDaily") : t("land.tierDaily", { n: CAPS[tier.name].daily })}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec gal" id="s08">
        <div className="wrap">
          <p className="eb">{t("land.galEyebrow")}</p>
          <h2>{t("land.galH")}<em>{t("land.galEm")}</em></h2>
          <p className="lead">{t("land.galLead")} <span className="mono" style={{ fontSize: 14 }}>{t("land.concept")}</span></p>
          <div className="gg">
            {CATALOG.map((k) => (
              <article className="gk" key={k.n}>
                <FoilCard finish={k.finish}>
                  <div className="top">
                    <span className="tier">{t(`finish.${k.finish}`)}</span>
                    <span className="oo">{t("land.oneOfOne")}</span>
                  </div>
                  <div className="art"><KeyArt n={k.n} alt={t("land.keyN", { n: k.n })} width={430} height={1080} /></div>
                  <h3>{t("land.keyN", { n: k.n })}</h3>
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
        </div>
      </section>

      <section className="sec ag" id="s09">
        <div className="wrap g">
          <div>
            <p className="eb">{t("land.agEyebrow")}</p>
            <h2>{t("land.agH")}<em>{t("land.agEm")}</em></h2>
            <p className="lead">{t("land.agLead")}</p>
            <div className="ops">{["info", "status", "quote", "mint", "account", "balance", "swap", "copy", "withdraw", "history"].map((op) => <span key={op}>{op}</span>)}</div>
          </div>
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
        </div>
      </section>

      <section className="sec proof" id="s11">
        <div className="wrap">
          <p className="eb">{t("proof.title")}</p>
          <h2>{t("proof.sub")}</h2>
          <ul>
            {TXS.map((x) => (
              <li key={x.hash}><span>{x.label}</span><a href={tx(x.hash)} target="_blank" rel="noreferrer">{x.hash.slice(0, 12)}…</a></li>
            ))}
            <li><span>{KEYS_CONTRACT}</span><a href={`https://nearblocks.io/address/${KEYS_CONTRACT}`}>{t("atlas.open")}</a></li>
            {config && <li><span>{t("proof.beats")}</span><span className="mono">{config.beats}</span></li>}
            {config && <li><span>{t("proof.royalty")}</span><span className="mono">{config.royalty_bps / 100}%</span></li>}
          </ul>
        </div>
      </section>

      <section className="cta" id="s10">
        <p className="eb">{t("land.ctaEyebrow")}</p>
        <div className="keys"><KeyArt n={5} alt="" width={415} height={1077} /><KeyArt n={7} alt="" width={469} height={1097} /><KeyArt n={9} alt="" width={496} height={1090} /></div>
        <h2>{t("land.ctaH")}<em>{t("land.ctaEm")}</em></h2>
        <div className="hero-actions" style={{ justifyContent: "center" }}>
          <Link className="btn b1" href="/mint">{t("land.mint")}</Link>
          <a className="btn b2" href="https://github.com/mohamedwael201193/keyhole#readme">{t("land.docs")}</a>
        </div>
      </section>
    </>
  );
}
