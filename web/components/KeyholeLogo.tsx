"use client";
import { useEffect, useState } from "react";

/**
 * Coloured medallion plus a wordmark. The mark is never filtered.
 * Ink or light comes from the surrounding text colour (ecru nav, teal nav, footer).
 * On the first load of a session the animated mark plays beside the wordmark.
 */
export function KeyholeLogo({ className = "h-9", tone = "ink" }: { className?: string; tone?: "ink" | "light" }) {
  const [intro, setIntro] = useState(false);
  useEffect(() => {
    if (sessionStorage.getItem("kh_intro") || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    sessionStorage.setItem("kh_intro", "1"); setIntro(true);
    const t = setTimeout(() => setIntro(false), 2600); return () => clearTimeout(t);
  }, []);
  return (
    <span className={`kh-logo ${className}`} role="img" aria-label="KEYHOLE" data-tone={tone}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={intro ? "/brand/mark-animated.svg" : "/brand/mark.svg"} alt="" aria-hidden="true" width={512} height={620} decoding="sync" />
      <span className="kh-word">KEYHOLE</span>
    </span>
  );
}
