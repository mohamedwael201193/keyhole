"use client";
/**
 * The how-it-works diagram: the NFT on NEAR, the Intel TDX enclave, NEAR Intents 1Click. Desktop draws the lines and pulses
 * (components/LandingMotion.tsx scrubs the pulses with the scroll); phones stack the three nodes with a plain line between them.
 * Pulses rest at the middle of each line until motion runs, so the still page reads the same.
 */
import { useI18n } from "@/lib/i18n";

const NODES = [
  { k: "1", t: "how1t", d: "how1d", at: 0 },
  { k: "2", t: "how2t", d: "how2d", at: 0.4 },
  { k: "3", t: "how3t", d: "how3d", at: 0.9 },
] as const;

export function HowDiagram() {
  const { t } = useI18n();
  return (
    <div className="how-stage">
      <svg className="how-lines" viewBox="0 0 1200 400" aria-hidden="true" focusable="false">
        <path id="how-a" className="how-line" d="M330 200 L460 200" />
        <path id="how-b" className="how-line" d="M740 200 L870 200" />
        <circle className="how-pulse" data-pulse data-path="how-a" data-from="0.05" data-to="0.45" cx="395" cy="200" r="7" />
        <circle className="how-pulse" data-pulse data-path="how-b" data-from="0.5" data-to="0.95" cx="805" cy="200" r="7" />
      </svg>
      <ol className="how-nodes">
        {NODES.map((n, i) => (
          <li key={n.k} className={`how-node how-node--${n.k}`} data-node data-at={n.at}>
            <span className="how-index mono" aria-hidden="true">{n.k}</span>
            <h3>{t(`home.${n.t}`)}</h3>
            <p>{t(`home.${n.d}`)}</p>
            {i < NODES.length - 1 && <span className="how-link" aria-hidden="true" />}
          </li>
        ))}
      </ol>
    </div>
  );
}
