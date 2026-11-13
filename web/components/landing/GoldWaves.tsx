/**
 * Decorative gold line waves: 12 parallel bezier strokes that fan out and pinch together, like the thin flowing lines in the
 * brand art. One component, three placements (hero, lock-out, pledge; the problem banner art carries its own waves) (`variant` sets the rotation and the mask). Pure SVG, no script, aria-hidden.
 */
const COUNT = 12;

const VARIANTS = {
  hero: { cls: "lp-waves--hero" },
  lock: { cls: "lp-waves--lock" },
  pledge: { cls: "lp-waves--pledge" },
} as const;

export type WavesVariant = keyof typeof VARIANTS;

/** The curve i of COUNT: both ends are shared, the middle spreads by i, so the lines read as one flowing ribbon. */
function wave(i: number): string {
  const t = i / (COUNT - 1);
  const spread = (t - 0.5) * 120;
  return `M0 ${150 + spread * 0.18} C 120 ${40 + spread}, 240 ${260 - spread}, 380 ${150 + spread * 0.5} S 560 ${90 - spread * 0.7}, 600 ${150 - spread * 0.18}`;
}

export function GoldWaves({ variant }: { variant: WavesVariant }) {
  return (
    <svg className={`lp-waves ${VARIANTS[variant].cls}`} viewBox="0 0 600 300" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <g fill="none" stroke="#C9A15A" strokeWidth="0.6" vectorEffect="non-scaling-stroke">
        {Array.from({ length: COUNT }, (_, i) => (
          <path key={i} d={wave(i)} vectorEffect="non-scaling-stroke" strokeOpacity={0.35 + 0.15 * Math.sin((i / (COUNT - 1)) * Math.PI)} />
        ))}
      </g>
    </svg>
  );
}
