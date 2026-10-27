"use client";
import { useEffect } from "react";

/**
 * Intro motion is CSS (the sketch's load timeline) so GSAP stays off the first paint.
 * Scroll scenes load on the first scroll, or after the page has gone quiet.
 * Skipped for prefers-reduced-motion and ?static.
 */
export function HomeMotion() {
  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stat = new URLSearchParams(location.search).has("static");
    if (reduce || stat) { document.documentElement.classList.add("no-motion"); return () => document.documentElement.classList.remove("no-motion"); }
    let dead = false;
    let revert: (() => void) | null = null;
    let started = false;
    const t0 = performance.now() + 600;
    const count = (now: number) => {
      if (dead) return;
      const p = Math.max(0, Math.min(1, (now - t0) / 2000));
      document.querySelectorAll<HTMLElement>("[data-count]").forEach((e) => {
        const v = +(e.dataset.count || 0);
        const d = +(e.dataset.dec || 0);
        e.textContent = (v * (p < 1 ? p : 1)).toFixed(d);
      });
      if (p < 1) requestAnimationFrame(count);
    };
    const raf = requestAnimationFrame(count);
    const start = () => { if (!started) { started = true; void run(); } };
    const onScroll = () => start();
    addEventListener("scroll", onScroll, { passive: true });
    const timer = window.setTimeout(start, 8000);
    return () => { dead = true; revert?.(); cancelAnimationFrame(raf); removeEventListener("scroll", onScroll); clearTimeout(timer); };
    async function run() {
      const { default: gsap } = await import("gsap");
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      if (dead) return;
      document.querySelectorAll<HTMLElement>(".sec, .cta").forEach((e) => { e.style.contentVisibility = "visible"; });
      gsap.registerPlugin(ScrollTrigger);
      const ctx = gsap.context(() => {
        gsap.to(".hkey", { yPercent: -10, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
        document.querySelectorAll(".sec h2,.sec .lead,.sec .eb").forEach((e) => gsap.from(e, { y: 40, opacity: 0, duration: 1, scrollTrigger: { trigger: e, start: "top 88%" } }));
        const p = document.getElementById("dl");
        if (p instanceof SVGPathElement) {
          const L = p.getTotalLength();
          p.style.strokeDasharray = `${L}`;
          p.style.strokeDashoffset = `${L}`;
          gsap.to(p, { strokeDashoffset: 0, ease: "none", scrollTrigger: { trigger: ".story .row", start: "top 80%", end: "bottom 60%", scrub: true } });
        }
        gsap.from(".story .st", { y: 60, opacity: 0, stagger: 0.2, scrollTrigger: { trigger: ".story .row", start: "top 80%" } });
        gsap.utils.toArray<Element>(".par").forEach((i) => gsap.fromTo(i, { scale: 1.12, yPercent: -4 }, { scale: 1, yPercent: 4, ease: "none", scrollTrigger: { trigger: i, start: "top bottom", end: "bottom top", scrub: true } }));
        gsap.from(".priv .lab", { y: 40, opacity: 0, stagger: 0.2, scrollTrigger: { trigger: ".priv .art", start: "top 70%" } });
        gsap.from(".attc", { x: 60, opacity: 0, scrollTrigger: { trigger: ".encl", start: "top 70%" } });
        gsap.from(".safe .card", { y: 70, opacity: 0, stagger: 0.12, scrollTrigger: { trigger: ".safe .g", start: "top 85%" } });
        gsap.from(".cg .c", { y: -120, rotation: -40, opacity: 0, stagger: 0.08, ease: "bounce.out", duration: 1.2, scrollTrigger: { trigger: ".cg", start: "top 85%" } });
        gsap.from(".tc", { y: 80, opacity: 0, stagger: 0.12, scrollTrigger: { trigger: ".tg", start: "top 85%" } });
        gsap.from(".gk", { y: 60, opacity: 0, rotationY: 25, stagger: 0.06, scrollTrigger: { trigger: ".gg", start: "top 85%" } });
        gsap.from(".term", { x: 80, opacity: 0, scrollTrigger: { trigger: ".ag", start: "top 75%" } });
        gsap.from(".cta .keys img", { y: 80, opacity: 0, stagger: 0.15, scrollTrigger: { trigger: ".cta", start: "top 75%" } });
      });
      revert = () => ctx.revert();
    }
  }, []);
  return null;
}
