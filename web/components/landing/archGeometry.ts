/**
 * The ivy-arch picture and where the real keys stand on it. hero-arch.webp is the source picture (1199 x 1312) cropped to
 * x 320..1199, y 0..590. cx and base are the generated key's stem centre and the foot of its finial on the pedestal, in source
 * pixels; the real key is a little larger (w is its width in source pixels, the height follows its own aspect ratio).
 * Used by the hero (animated) and the closing card (still), so both place the keys on the same spot.
 */
export const CROP = { x: 320, y: 0, w: 879, h: 590 } as const;

export type ArchKey = { n: number; tier: "Bronze" | "Silver" | "Gold"; alt: string; cx: number; base: number; w: number; ar: number; plaqueY: number; plaqueW: number };

export const ARCH_KEYS: ArchKey[] = [
  { n: 3, tier: "Bronze", alt: "landing2.v2.hero.keyBronze", cx: 660, base: 418, w: 136, ar: 433 / 1077, plaqueY: 446, plaqueW: 124 },
  { n: 4, tier: "Silver", alt: "landing2.v2.hero.keySilver", cx: 817.5, base: 390, w: 130, ar: 406 / 1084, plaqueY: 432, plaqueW: 132 },
  { n: 2, tier: "Gold", alt: "landing2.v2.hero.keyGold", cx: 972, base: 418, w: 132, ar: 409 / 1094, plaqueY: 446, plaqueW: 124 },
];

export const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;

export function keyBox(k: ArchKey) {
  const h = k.w / k.ar;
  return { left: pct(k.cx - k.w / 2 - CROP.x, CROP.w), top: pct(k.base - h - CROP.y, CROP.h), width: pct(k.w, CROP.w), height: pct(h, CROP.h) };
}
