"use client";
/**
 * GSAP motion for the landing, the only place GSAP runs on the public site. Each piece renders its final state on the server
 * and without JavaScript; the animation only starts after hydration. Everything is off under prefers-reduced-motion and when the
 * page is opened with ?static (the same switch as HomeMotion). matchMedia reverts every ScrollTrigger on unmount.
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
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
 * The handover, the one dealt moment. On desktop the section is pinned for one viewport of scroll and its three steps are
 * reached in turn: the step the scroll is on is lit, the others rest dimmed (`data-on` on each `[data-step]`). Phones, tablets
 * and reduced motion get the plain stack with every step at full strength; nothing is pinned there.
 *
 * The pin is set up in a layout effect so it is undone before React removes the section from the DOM (a pin wraps the
 * section in a spacer). Undoing it in a passive effect would leave the section inside the spacer when the page unmounts.
 */
export function HandoverMoment({ children, className, id, labelledBy }: { children: ReactNode; className?: string; id?: string; labelledBy?: string }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    register();
    const mm = gsap.matchMedia();
    mm.add(`${DESKTOP} and ${MOTION_OK}`, () => {
      if (motionOff()) return;
      const steps = Array.from(root.querySelectorAll<HTMLElement>("[data-step]"));
      const light = (p: number) => {
        const active = Math.min(steps.length - 1, Math.floor(p * steps.length));
        steps.forEach((el, i) => { el.dataset.on = i <= active ? "true" : "false"; });
      };
      root.dataset.pinned = "true";
      light(0);
      const st = ScrollTrigger.create({
        trigger: root,
        start: "top top",
        end: () => `+=${window.innerHeight}`,
        pin: true,
        scrub: 0.6,
        invalidateOnRefresh: true,
        onUpdate: (self) => light(self.progress),
      });
      // Fonts change the layout after first paint; re-measure so the pin length matches the screen.
      void document.fonts?.ready.then(() => ScrollTrigger.refresh());
      return () => {
        st.kill(true);
        delete root.dataset.pinned;
        steps.forEach((el) => { delete el.dataset.on; });
      };
    });
    return () => mm.revert();
  }, []);
  return <section ref={ref} id={id} className={className} aria-labelledby={labelledBy}>{children}</section>;
}
