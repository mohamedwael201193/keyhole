"use client";
import { useEffect, useState } from "react";

const RATIO = 640.83 / 158.6; // lockup.svg viewBox
const MARK_FRAC = 0.197; // share of the lockup width taken by the mark

/**
 * Brand lockup (mark + KEYHOLE wordmark). Rebrand by replacing public/brand/{lockup,mark-animated}.svg.
 * On the first load of a session the animated mark plays and the wordmark fades in beside it,
 * so the full lockup always reads, never the mark alone.
 */
export function KeyholeLogo({ className = "h-8 sm:h-10" }: { className?: string }) {
  const [intro, setIntro] = useState(false);
  useEffect(() => {
    if (sessionStorage.getItem("kh_intro") || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    sessionStorage.setItem("kh_intro", "1"); setIntro(true);
    const t = setTimeout(() => setIntro(false), 2600); return () => clearTimeout(t);
  }, []);
  return (
    <span className={`relative inline-flex items-center ${className}`} role="img" aria-label="KEYHOLE" style={{ aspectRatio: String(RATIO) }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/lockup.svg" alt="" aria-hidden="true" width={641} height={159} decoding="sync"
        className="h-full w-full select-none" style={intro ? { clipPath: `inset(0 0 0 ${MARK_FRAC * 100}%)`, animation: "rise .8s ease-out .9s both" } : undefined} />
      {intro && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/brand/mark-animated.svg" alt="" aria-hidden="true" className="absolute inset-y-0 start-0 h-full w-auto" style={{ maxWidth: `${MARK_FRAC * 100}%`, objectFit: "contain", objectPosition: "left center" }} />
      )}
    </span>
  );
}
