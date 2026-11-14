"use client";
/**
 * The keys: the four real FoilCards (the same component /mint and /keys draw) in a gentle fan. Hover or focus lifts one card,
 * straightens it and sweeps its foil once; the others ease apart. Under each card: the real limits from lib/traits CAPS, limits
 * only. Bronze is the one key a mint gives today; the others are previews, as on /mint. On phones the fan becomes a scroll-snap row.
 */
import Link from "next/link";
import { KeyArt } from "@/components/Art";
import { FoilCard } from "@/components/FoilCard";
import { useI18n } from "@/lib/i18n";
import { formatTradePrice } from "@/lib/price";
import { CAPS, type Finish } from "@/lib/traits";
import { Icon } from "./icons";

/** Fan angles, left to right, and the key art of each finish (the same numbers as app/mint/view.tsx). */
const CARDS: { finish: Finish; art: number; rot: number; mintable: boolean }[] = [
  { finish: "Bronze", art: 3, rot: -8, mintable: true },
  { finish: "Silver", art: 4, rot: -3, mintable: false },
  { finish: "Gold", art: 2, rot: 3, mintable: false },
  { finish: "Legendary", art: 1, rot: 8, mintable: false },
];

export function KeysFan() {
  const { t } = useI18n();
  return (
    <section className="lp-sec lp-keys" id="keys" aria-labelledby="keys-h">
      <div className="lp-wrap">
        <header className="lp-head">
          <p className="lp-eyebrow lp-eyebrow--centre">{t("landing2.v2.keys.eyebrow")}</p>
          <h2 id="keys-h" className="lp-h2 lp-h2--centre">{t("landing2.v2.keys.h2")}</h2>
          <p className="lp-body lp-body--centre">{t("gallery.lead")}</p>
        </header>
        <ul className="lp-fan" aria-label={t("landing2.v2.keys.region")}>
          {CARDS.map((c) => (
            <li key={c.finish} className="lp-fcard" style={{ "--r": `${c.rot}deg` } as React.CSSProperties} data-finish={c.finish.toLowerCase()}>
              <Link href="/mint" className="lp-fcard-link" aria-label={c.finish === "Legendary" ? `${t(`finish.${c.finish}`)} · cosmetic finish on Gold · same $100 / trade · $500 / day caps` : `${t(`finish.${c.finish}`)} · ${formatTradePrice(CAPS[c.finish].perTx)} · $${CAPS[c.finish].daily} ${t("landing2.v2.keys.daily")}`}>
                <FoilCard finish={c.finish} as="div" className="lp-fcard-card">
                  <div className="top">
                    <span className="tier">{t(`finish.${c.finish}`)}</span>
                    <span className="oo">{c.mintable ? t("landing2.v2.keys.mintable") : t("landing2.v2.keys.preview")}</span>
                  </div>
                  <div className="art"><KeyArt n={c.art} alt="" width={430} height={1080} /></div>
                </FoilCard>
              </Link>
              <p className="lp-fcard-caps">
                {c.finish === "Legendary" ? (
                  <span>Cosmetic finish on Gold — same $100 / trade · $500 / day caps</span>
                ) : (
                  <>
                    <span>{formatTradePrice(CAPS[c.finish].perTx)}</span><span className="lp-sep"> · </span><span>{`$${CAPS[c.finish].daily} ${t("landing2.v2.keys.daily")}`}</span>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
        <div className="lp-cta lp-cta--centre">
          <Link href="/mint" className="lp-btn lp-btn--primary" data-testid="keys-mint-cta">{t("landing2.v2.keys.mint")}<Icon name="arrow" size={18} /></Link>
        </div>
      </div>
    </section>
  );
}
