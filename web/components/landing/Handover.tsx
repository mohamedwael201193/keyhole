"use client";
/**
 * The three steps of the mainnet handover. Each card is one real call or transaction: the withdraw before the sale, the NFT
 * transfer, and the refused call after it. The ids are the ones in README.md (section "Current build"). On desktop the parent
 * (components/LandingMotion.tsx, HandoverMoment) marks each card as reached while the section is pinned.
 */
import { nearTx } from "@/lib/explorer";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";

const STEPS = [
  { title: "lp.step1T", body: "lp.step1D", chip: "lp.chipAllowed", tone: "ok", id: "440c2378", href: "/verify?call=440c2378-6c27-49fd-8b6b-d74054f331ae", open: "lp.openProof" },
  { title: "lp.step2T", body: "lp.step2D", chip: "lp.chipMoved", tone: "info", id: "G35r5pmC", href: nearTx("G35r5pmCTffvKMShjPcwTkds1z8SuCHdJr32qGGzYktD"), open: "lp.openNear" },
  { title: "lp.step3T", body: "lp.step3D", chip: "lp.chipRefused", tone: "bad", id: "e805f050", href: "/verify?call=e805f050-d416-4a04-9b12-270adbe02068", open: "lp.openProof" },
] as const;

export function Handover() {
  const { t } = useI18n();
  return (
    <ol className="hand-steps">
      {STEPS.map((s, i) => {
        const inner = <>{t(s.open)} <span aria-hidden="true">↗</span></>;
        const internal = s.href.startsWith("/");
        return (
          <li key={s.id} className="hand-step" data-step={i + 1} data-testid={`handover-step-${i + 1}`}>
            <div className="hand-head">
              <span className="hand-n mono" aria-hidden="true">0{i + 1}</span>
              <span className={`hand-chip ${s.tone}`} data-testid={`handover-chip-${i + 1}`}>{t(s.chip)}</span>
            </div>
            <h3>{t(s.title)}</h3>
            <p>{t(s.body)}</p>
            <div className="hand-foot">
              <span className="hand-id mono">{s.id}…</span>
              {internal
                ? <Link href={s.href} className="hand-open" data-testid={`handover-link-${i + 1}`}>{inner}</Link>
                : <a href={s.href} className="hand-open" target="_blank" rel="noopener noreferrer" data-testid={`handover-link-${i + 1}`}>{inner}</a>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
