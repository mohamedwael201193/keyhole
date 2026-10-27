"use client";
import { useEffect, useState } from "react";
/** Brand lockup. Swap files in public/brand/ (lockup.svg, mark.svg, mark-animated.svg) to rebrand. */
export function KeyholeLogo({ size = 26 }: { size?: number }) {
  // Animated mark plays once per session on first load, then the static lockup.
  const [intro, setIntro] = useState(false);
  useEffect(() => {
    if (sessionStorage.getItem("kh_intro") || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    sessionStorage.setItem("kh_intro", "1"); setIntro(true);
    const t = setTimeout(() => setIntro(false), 2600); return () => clearTimeout(t);
  }, []);
  const w = Math.round(size * 4.04);
  return (
    <span className="inline-flex items-center" role="img" aria-label="KEYHOLE">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {intro ? <img src="/brand/mark-animated.svg" width={Math.round(size * 0.826)} height={size} alt="" aria-hidden="true" />
        : <img src="/brand/lockup.svg" width={w} height={size} alt="" aria-hidden="true" style={{ height: size, width: "auto" }} />}
    </span>
  );
}
