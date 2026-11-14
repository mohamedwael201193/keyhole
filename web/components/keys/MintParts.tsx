"use client";
import { useState } from "react";
import { KeyArt } from "@/components/Art";
import { FoilCard } from "@/components/FoilCard";
import { CAPS, type Finish } from "@/lib/traits";
import { formatTradePrice } from "@/lib/price";
import { Icon, StatusChip, TierChip } from "@/components/v7";

/** The three steps of a mint, each state set by the page from the real mint state. */
export type MintStep = { id: string; label: string; state: "done" | "current" | "todo" };

const WORD: Record<MintStep["state"], string> = { done: "done", current: "current", todo: "to do" };

export function MintStepper({ steps }: { steps: MintStep[] }) {
  return (
    <ol className="km-steps" aria-label="Mint progress" data-testid="mint-steps">
      {steps.map((s, i) => (
        <li key={s.id} className={`km-step is-${s.state}`} aria-current={s.state === "current" ? "step" : undefined} data-state={s.state} data-testid={`mint-step-${s.id}`}>
          <span className="km-step-dot" aria-hidden="true">{s.state === "done" ? <Icon name="check" size={15} /> : i + 1}</span>
          <span className="km-step-label">{s.label}</span>
          <span className="v7-sr-only">, {WORD[s.state]}</span>
        </li>
      ))}
    </ol>
  );
}

/** One slide of the art preview. `mintable` is true only for the finish the mint gives today (Bronze). */
export type PreviewSlide = { finish: Finish; art: number; mintable: boolean };

/** The art carousel: previous and next buttons, a "n of N" count and the slide's caps. Changes only the picture shown. */
export function PreviewCarousel({ slides, startAt = 0 }: { slides: PreviewSlide[]; startAt?: number }) {
  const [i, setI] = useState(startAt);
  const n = slides.length;
  const cur = slides[i];
  const go = (d: number) => setI((x) => (x + d + n) % n);
  return (
    <div className="km-carousel" role="region" aria-roledescription="carousel" aria-label="Key art preview" data-testid="mint-carousel">
      <div className="km-stage">
        <FoilCard finish={cur.finish} className="km-foil">
          <div className="top">
            <span className="tier">{cur.finish}</span>
            <span className="oo">{cur.mintable ? "Mintable" : "Preview"}</span>
          </div>
          <div className="art">
            <KeyArt key={cur.art} n={cur.art} alt={`${cur.finish} key art`} width={430} height={1080} className="km-art" />
          </div>
        </FoilCard>
      </div>
      <div className="km-caption">
        <TierChip tier={cur.finish} />
        <p className="km-caption-name">{cur.finish} Key</p>
        <p className="km-caption-cap">{formatTradePrice(CAPS[cur.finish].perTx)} · ${CAPS[cur.finish].daily} a day</p>
        {cur.mintable ? <StatusChip tone="success">Mintable</StatusChip> : <StatusChip tone="neutral" icon="none">Preview only</StatusChip>}
      </div>
      <div className="km-nav">
        <button type="button" className="km-arrow" onClick={() => go(-1)} aria-label="Previous key" data-testid="mint-prev">
          <Icon name="chevron-right" size={18} className="km-arrow-flip" />
        </button>
        <span className="km-count" aria-live="polite" data-testid="mint-count">{i + 1} of {n}</span>
        <button type="button" className="km-arrow" onClick={() => go(1)} aria-label="Next key" data-testid="mint-next">
          <Icon name="chevron-right" size={18} />
        </button>
      </div>
    </div>
  );
}

/**
 * One tier in the picker. Bronze is the one the mint gives today and is marked selected. The others are not choices: they
 * show the real caps and the real rule that earns them, and no control.
 */
export function TierOption({ finish, mintable, rule }: { finish: Finish; mintable: boolean; rule: string }) {
  const caps = CAPS[finish];
  return (
    <div className={`km-tier${mintable ? " is-selected" : " is-locked"}`} data-testid={`mint-tier-${finish.toLowerCase()}`} data-mintable={String(mintable)}>
      <div className="km-tier-top">
        <TierChip tier={finish} />
        {mintable ? <span className="km-radio" aria-hidden="true" /> : <Icon name="lock" size={16} className="km-tier-lock" />}
      </div>
      <p className="km-tier-cap">{formatTradePrice(caps.perTx)}</p>
      <p className="km-tier-day">${caps.daily} a day</p>
      <p className="km-tier-rule">{rule}</p>
      <p className="km-tier-state">{mintable ? <StatusChip tone="success">Selected · mintable</StatusChip> : <StatusChip tone="neutral" icon="none">Earned, not minted</StatusChip>}</p>
    </div>
  );
}
