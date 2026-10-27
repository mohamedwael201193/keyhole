"use client";
import { useEffect } from "react";

/**
 * Intro motion is CSS (the sketch's load timeline) so GSAP stays off the first paint.
 * Scroll scenes load on the first scroll, a hash jump, or after the page has gone quiet.
 * Anything already on screen is left visible. A watchdog clears a reveal that is in view
 * but still transparent, so a jump, anchor, resize, slow script, or screenshot cannot
 * leave a section blank. Skipped for prefers-reduced-motion and ?static.
 */
const REVEALS: { targets: string; trigger?: string; start: string; vars: Record<string, unknown> }[] = [
  { targets: ".sec h2, .sec .lead, .sec .eb", start: "top 88%", vars: { y: 40, opacity: 0, duration: 1 } },
  { targets: ".story .st", trigger: ".story .row", start: "top 80%", vars: { y: 60, opacity: 0, stagger: 0.2 } },
  { targets: ".priv .lab", trigger: ".priv .art", start: "top 70%", vars: { y: 40, opacity: 0, stagger: 0.2 } },
  { targets: ".attc", trigger: ".encl", start: "top 70%", vars: { x: 60, opacity: 0 } },
  { targets: ".safe .card", trigger: ".safe .g", start: "top 85%", vars: { y: 70, opacity: 0, stagger: 0.12 } },
  { targets: ".cg .c", trigger: ".cg", start: "top 85%", vars: { y: -120, rotation: -40, opacity: 0, stagger: 0.08, ease: "bounce.out", duration: 1.2 } },
  { targets: ".tc", trigger: ".tg", start: "top 85%", vars: { y: 80, opacity: 0, stagger: 0.12 } },
  { targets: ".gk", trigger: ".gg", start: "top 85%", vars: { y: 60, opacity: 0, rotationY: 25, stagger: 0.06 } },
  { targets: ".term", trigger: ".ag", start: "top 75%", vars: { x: 80, opacity: 0 } },
  { targets: ".cta .keys img", trigger: ".cta", start: "top 75%", vars: { y: 80, opacity: 0, stagger: 0.15 } },
];

const REVEAL_SEL = REVEALS.map((r) => r.targets).join(", ");

function inView(el: Element) {
  const r = el.getBoundingClientRect();
  const h = window.innerHeight || document.documentElement.clientHeight || 1;
  return r.bottom > 0 && r.top < h;
}

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
    addEventListener("scroll", start, { passive: true });
    addEventListener("hashchange", start);
    addEventListener("resize", start);
    if (location.hash || scrollY > 8) start();
    const timer = window.setTimeout(start, 8000);
    return () => { dead = true; revert?.(); cancelAnimationFrame(raf); removeEventListener("scroll", start); removeEventListener("hashchange", start); removeEventListener("resize", start); clearTimeout(timer); };
    async function run() {
      const { default: gsap } = await import("gsap");
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      if (dead) return;
      gsap.registerPlugin(ScrollTrigger);
      const show = (el: Element) => {
        gsap.killTweensOf(el);
        gsap.set(el, { clearProps: "opacity,visibility,transform" });
      };
      const unstick = () => {
        document.querySelectorAll(REVEAL_SEL).forEach((el) => {
          if (!inView(el)) return;
          if (parseFloat(getComputedStyle(el).opacity) > 0.9) return;
          const playing = gsap.getTweensOf(el).some((t) => t.isActive() && t.progress() > 0.02 && t.progress() < 0.98);
          if (!playing) show(el);
        });
      };
      let queued = false;
      const schedule = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; if (!dead) unstick(); });
      };
      const ctx = gsap.context(() => {
        gsap.to(".hkey", { yPercent: -10, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
        const p = document.getElementById("dl");
        if (p instanceof SVGPathElement) {
          const L = p.getTotalLength();
          p.style.strokeDasharray = `${L}`;
          p.style.strokeDashoffset = `${L}`;
          gsap.to(p, { strokeDashoffset: 0, ease: "none", scrollTrigger: { trigger: ".story .row", start: "top 80%", end: "bottom 60%", scrub: true } });
        }
        gsap.utils.toArray<Element>(".par").forEach((i) => gsap.fromTo(i, { scale: 1.12, yPercent: -4 }, { scale: 1, yPercent: 4, ease: "none", scrollTrigger: { trigger: i, start: "top bottom", end: "bottom top", scrub: true } }));
        for (const spec of REVEALS) {
          const nodes = gsap.utils.toArray<Element>(spec.targets);
          if (!nodes.length) continue;
          const host = spec.trigger ? document.querySelector(spec.trigger) : null;
          if (spec.trigger) {
            if (!host || inView(host)) continue;
            gsap.from(nodes, { ...spec.vars, scrollTrigger: { trigger: host, start: spec.start, once: true, toggleActions: "play none none none" } });
          } else {
            nodes.forEach((el) => {
              if (inView(el)) return;
              gsap.from(el, { ...spec.vars, scrollTrigger: { trigger: el, start: spec.start, once: true, toggleActions: "play none none none" } });
            });
          }
        }
      });
      ScrollTrigger.refresh();
      unstick();
      addEventListener("scroll", schedule, { passive: true });
      addEventListener("resize", schedule);
      addEventListener("hashchange", schedule);
      const watch = window.setInterval(unstick, 250);
      revert = () => {
        clearInterval(watch);
        removeEventListener("scroll", schedule);
        removeEventListener("resize", schedule);
        removeEventListener("hashchange", schedule);
        ctx.revert();
      };
    }
  }, []);
  return null;
}
