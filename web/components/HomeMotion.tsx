"use client";
import { useEffect } from "react";

/**
 * Landing-only motion that is not a section primitive: the hero key drifts slowly on scroll, and
 * `?static` or prefers-reduced-motion switch every decorative animation off (html.no-motion, heirloom.css).
 * Section reveals, parallax, tilt and count-up live in components/motion and respect the same switch.
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
    const key = document.querySelector<HTMLElement>(".hkey");
    let ticking = false;
    const onScroll = () => {
      if (ticking || !key) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; const y = Math.min(scrollY, 900); key.style.translate = `0 ${(-y * 0.08).toFixed(1)}px`; });
    };
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      removeEventListener("scroll", onScroll);
      key?.style.removeProperty("translate");
    };
  }, []);
  return null;
}
