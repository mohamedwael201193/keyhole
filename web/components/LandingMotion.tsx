"use client";
/**
 * GSAP motion for the landing, the only place GSAP runs on the public site. Each piece renders its final state on the server
 * and without JavaScript; the animation only starts after hydration. Everything is off under prefers-reduced-motion and when the
 * page is opened with ?static (the same switch as HomeMotion). matchMedia reverts every ScrollTrigger on unmount.
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
 * The how-it-works moment. The section is two screens tall; its stage sticks inside it (CSS), and a ScrollTrigger scrubs the
 * pulses along the lines and lights each node as the pulse reaches it. No pin, no scroll-jacking, nothing else moves.
 * Pulses are `[data-pulse]` circles on a `[data-path]` line, running from `data-from` to `data-to` of the scroll; nodes are
 * `[data-node]` lit at `data-at`. Phones and tablets keep the still diagram (no pulses are drawn there).
 */
export function HowMoment({ children, className, labelledBy }: { children: ReactNode; className?: string; labelledBy?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    register();
    const mm = gsap.matchMedia();
    mm.add(`${DESKTOP} and ${MOTION_OK}`, () => {
      if (motionOff()) return;
      const pulses = Array.from(root.querySelectorAll<SVGCircleElement>("[data-pulse]")).flatMap((el) => {
        const path = root.querySelector<SVGPathElement>(`#${CSS.escape(el.dataset.path ?? "")}`);
        if (!path) return [];
        return [{ el, path, len: path.getTotalLength(), from: Number(el.dataset.from), to: Number(el.dataset.to) }];
      });
      const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-node]")).map((el) => ({ el, at: Number(el.dataset.at) }));
      const st = ScrollTrigger.create({
        trigger: root,
        start: "top top",
        end: "bottom bottom",
        scrub: 0.6,
        onUpdate: (self) => {
          const p = self.progress;
          for (const { el, path, len, from, to } of pulses) {
            const local = gsap.utils.clamp(0, 1, (p - from) / (to - from));
            const pt = path.getPointAtLength(local * len);
            el.setAttribute("cx", pt.x.toFixed(1));
            el.setAttribute("cy", pt.y.toFixed(1));
            el.style.opacity = p < from || p > to ? "0" : "1";
          }
          for (const n of nodes) n.el.classList.toggle("is-lit", p >= n.at);
        },
      });
      // Fonts and images change the layout after first paint; re-measure so the scroll range lines up.
      void document.fonts?.ready.then(() => ScrollTrigger.refresh());
      return () => st.kill();
    });
    return () => mm.revert();
  }, []);
  return <section ref={ref} id="how" className={className} aria-labelledby={labelledBy}>{children}</section>;
}
