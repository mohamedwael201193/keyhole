"use client";
/**
 * GSAP motion for the landing, the only place GSAP runs on the public site. Each piece renders its final state on the server
 * and without JavaScript; the animation only starts after hydration. Everything is off under prefers-reduced-motion and when the
 * page is opened with ?static (the same switch as HomeMotion). matchMedia reverts every tween and ScrollTrigger on unmount.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const MOTION_OK = "(prefers-reduced-motion: no-preference)";
const DESKTOP = "(min-width: 861px)";

let registered = false;
function register() {
  if (registered) return;
  gsap.registerPlugin(ScrollTrigger);
  registered = true;
}

function motionOff() {
  return new URLSearchParams(location.search).has("static") || document.documentElement.classList.contains("no-motion");
}

/**
 * Hero text reveal on load: each headline line rises out of its mask, then the lead and the actions follow.
 * Only the marked nodes move (.lp-line, .lp-reveal); the hero key and orbit are not touched.
 */
export function HeroIntro({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    register();
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      if (motionOff()) return;
      const lines = root.querySelectorAll(".lp-line");
      const rest = root.querySelectorAll(".lp-reveal");
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from(lines, { yPercent: 110, duration: 1.1, stagger: 0.14 })
        .from(rest, { y: 18, opacity: 0, duration: 0.9, stagger: 0.09 }, "-=0.7");
      return () => { tl.kill(); };
    });
    return () => mm.revert();
  }, []);
  return <div ref={ref} className={className}>{children}</div>;
}

/**
 * "How it works" on desktop: the section pins while the three steps light up one after another, scrubbed to the scroll,
 * with a progress rule underneath. Phones and tablets keep the plain stack (no pin, no animation).
 */
export function HowPin({ children, className, labelledBy }: { children: ReactNode; className?: string; labelledBy?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    register();
    const mm = gsap.matchMedia();
    mm.add(`${DESKTOP} and ${MOTION_OK}`, () => {
      if (motionOff()) return;
      const steps = gsap.utils.toArray<HTMLElement>(root.querySelectorAll(".lp-step"));
      const bar = root.querySelector<HTMLElement>(".lp-how-bar");
      const tl = gsap.timeline({
        scrollTrigger: { trigger: root, start: "top top", end: "+=120%", pin: true, scrub: 0.6, anticipatePin: 1 },
      });
      tl.fromTo(steps, { opacity: 0.16, y: 40 }, { opacity: 1, y: 0, duration: 1, stagger: 1, ease: "power2.out" }, 0);
      if (bar) tl.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: steps.length, ease: "none" }, 0);
      // Fonts and images change the layout after first paint; re-measure so the pin lines up.
      void document.fonts?.ready.then(() => ScrollTrigger.refresh());
    });
    return () => mm.revert();
  }, []);
  return <section ref={ref} className={className} aria-labelledby={labelledBy}>{children}</section>;
}
