"use client";
/**
 * "The collection": a grid of real keys read from NEAR, then the Silver and Gold previews, labelled as not minted. The count
 * comes from the holder count on mainnet (lib/supply.ts, polled for a short while when the server could not read it).
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { FoilCard } from "@/components/FoilCard";
import { KeyArt } from "@/components/Art";
import { KeyCard } from "@/components/KeyCard";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { formatTradePrice } from "@/lib/price";
import { CAPS, type Finish } from "@/lib/traits";
import type { Token } from "@/lib/near";

/** Finishes shown as labelled previews only. Silver and Gold are not mintable today (README: only Bronze). */
const PREVIEWS: { name: Finish; art: number }[] = [{ name: "Silver", art: 4 }, { name: "Gold", art: 2 }];
const SHOWN = 4;

export function SupplyStat({ initial }: { initial: number | null }) {
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

export function Collection({ supply, tokens, tiers }: { supply: number | null; tokens: Token[]; tiers: (number | null)[] }) {
  const { t } = useI18n();
  const shown = tokens.slice(0, SHOWN);
  return (
    <>
      <div className="lp-head">
        <h2 id="keys-h" className="lp-h2">{t("land.galH")}<em>{t("land.galEm")}</em></h2>
        <p className="lp-lead">{t("home.collLead")}</p>
        <p className="lp-supply"><span>{t("home.supplyLabel")}</span> <SupplyStat initial={supply} /></p>
        <p className="lp-note" data-testid="concept-banner"><b>{t("land.concept")}</b> <Link href="/gallery" className="lp-link">{t("land.conceptLive")} →</Link></p>
        <p className="lp-note" data-testid="tier-note">{t("land.tierLead")}</p>
      </div>
      <div className="lp-grid">
        {tokens.length === 0 && <p className="lp-empty">{t("land.noKeys")}</p>}
        {shown.map((tok, i) => (
          <div className="lp-card" key={tok.token_id}>
            <KeyCard token={tok} tier={tiers[i] ?? null} viewer={null} displayIndex={i + 1} />
          </div>
        ))}
        {PREVIEWS.map((p) => (
          <div className="lp-card" key={p.name}>
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
          </div>
        ))}
      </div>
      <div className="lp-cta">
        <Button href="/gallery" variant="secondary" testid="gallery-link">{t("land.browseAll")}</Button>
      </div>
    </>
  );
}
