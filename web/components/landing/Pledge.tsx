"use client";
/**
 * Pledge, contract-enforced states only. Left: the claim, the "not open for lending yet" badge and the link to how it works.
 * Right: a horizontal timeline (Pledge, Locked, Repay, Default) on a gold line. While in view a 6 s loop sends a brass dot along the
 * line and each node brightens as it passes; a pause control stops it. Reduced motion: static. On phones the timeline is vertical.
 */
import { useRef } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { useLoop } from "../LandingMotion";
import { GoldWaves } from "./GoldWaves";
import { Icon, type IconName } from "./icons";
import { LoopControl } from "./LoopControl";

const NODES: { icon: IconName; n: string; d: string; filled?: boolean }[] = [
  { icon: "coins", n: "landing2.v2.pledge.n1", d: "landing2.v2.pledge.d1" },
  { icon: "lock", n: "landing2.v2.pledge.n2", d: "landing2.v2.pledge.d2", filled: true },
  { icon: "check", n: "landing2.v2.pledge.n3", d: "landing2.v2.pledge.d3" },
  { icon: "gavel", n: "landing2.v2.pledge.n4", d: "landing2.v2.pledge.d4" },
];

export function Pledge() {
  const { t } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const loop = useLoop(ref);
  return (
    <section className="lp-sec lp-pledge" id="pledge" aria-labelledby="pledge-h" ref={ref}>
      <GoldWaves variant="pledge" />
      <div className="lp-wrap lp-pledge-grid">
        <div className="lp-pledge-copy">
          <p className="lp-eyebrow">{t("landing2.v2.pledge.eyebrow")}</p>
          <h2 id="pledge-h" className="lp-h2">{t("landing2.v2.pledge.h2")}</h2>
          <p className="lp-chip" data-testid="pledge-badge">{t("landing2.v2.pledge.badge")}</p>
          <p className="lp-body">{t("landing2.v2.pledge.body")}</p>
          <div className="lp-cta lp-cta--tight">
            <Link href="/pledge" className="lp-btn lp-btn--ghost" data-testid="pledge-cta">{t("landing2.v2.pledge.cta")}<Icon name="arrow" size={18} /></Link>
          </div>
        </div>
        <div className="lp-timeline" data-loop={loop.running ? "on" : "off"}>
          <ol className="lp-tl">
            {NODES.map((n, i) => (
              <li key={n.n} className={`lp-tl-node${n.filled ? " is-filled" : ""}`} style={{ "--i": i } as React.CSSProperties}>
                <span className="lp-tl-dot"><Icon name={n.icon} size={32} /></span>
                <h3>{t(n.n)}</h3>
                <p>{t(n.d)}</p>
              </li>
            ))}
          </ol>
          <span className="lp-tl-pulse" aria-hidden="true" />
          <LoopControl className="lp-tl-ctl" paused={loop.paused} onToggle={loop.toggle} pauseLabel={t("landing2.v2.pledge.pause")} playLabel={t("landing2.v2.pledge.play")} />
        </div>
      </div>
    </section>
  );
}
