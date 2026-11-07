"use client";
import { useEffect } from "react";

/**
 * Landing-only switch for decorative motion. `?static` or prefers-reduced-motion set html.no-motion (heirloom.css and
 * polish.css stop their loops and entrances). The hero key does not move with the scroll: scrolling moves only the
 * how-it-works moment (components/LandingMotion.tsx).
 */
export function HomeMotion() {
  useEffect(() => {
    const root = document.documentElement;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stat = new URLSearchParams(location.search).has("static");
    if (reduce || stat) {
      root.classList.add("no-motion");
      return () => root.classList.remove("no-motion");
    }
  }, []);
  return null;
}
