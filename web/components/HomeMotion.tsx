"use client";
import { useEffect } from "react";

/** The sketch's GSAP timeline. Skipped for prefers-reduced-motion and ?static. */
export function HomeMotion() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (new URLSearchParams(location.search).has("static")) return;
    let dead = false;
    let revert: (() => void) | null = null;
    (async () => {
      const { default: gsap } = await import("gsap");
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      if (dead) return;
      gsap.registerPlugin(ScrollTrigger);
      const ctx = gsap.context(() => {
        gsap.from(".hero h1,.hero .lead,.hero .eb,.hero .btn,.stats", { y: 30, opacity: 0, stagger: 0.08, duration: 1, ease: "power3.out" });
        gsap.from(".hkey", { scale: 0.85, opacity: 0, duration: 1.6, ease: "power3.out" });
        gsap.to(".ring", { rotation: 360, duration: 60, repeat: -1, ease: "none" });
        gsap.from(".orbit .m-in", { scale: 0, opacity: 0, stagger: 0.08, delay: 0.6, duration: 0.8, ease: "back.out(2)" });
        gsap.from(".beat", { x: 40, opacity: 0, stagger: 0.15, delay: 0.4, duration: 0.9 });
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
        document.querySelectorAll<HTMLElement>("[data-count]").forEach((e) => {
          const v = +(e.dataset.count || 0);
          const d = +(e.dataset.dec || 0);
          const o = { v: 0 };
          gsap.to(o, { v, duration: 2, delay: 0.6, onUpdate: () => { e.textContent = o.v.toFixed(d); } });
        });
      });
      revert = () => ctx.revert();
    })();
    return () => { dead = true; revert?.(); };
  }, []);
  return null;
}
