"use client";
/**
 * GSAP motion for the landing, the only place GSAP runs on the public site. The page renders its final state on the server and
 * without JavaScript; the pin is set up after hydration. Off under prefers-reduced-motion, html.no-motion and ?static (the same
 * switch as HomeMotion). matchMedia reverts every ScrollTrigger and inline style on unmount.
 */
import { useLayoutEffect, useRef, type ReactNode } from "react";
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
 * The keyhole moment, the one pinned section. On desktop it is pinned for two viewports of scroll. The real key ([data-key])
 * starts upright above the keyhole and turns 90 degrees as it seats in the lock. Three steps ([data-step]) are reached in turn:
 * the step the scroll is on is lit, the others rest dimmed (`data-on`). Phones, tablets and reduced motion get the final frame.
 *
 * The pin is set up in a layout effect so it is undone before React removes the section (a pin wraps the section in a spacer).
 */
export function KeyholeMoment({ children, className, id, labelledBy }: { children: ReactNode; className?: string; id?: string; labelledBy?: string }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    register();
    const mm = gsap.matchMedia();
    mm.add(`${DESKTOP} and ${MOTION_OK}`, () => {
      if (motionOff()) return;
      const key = root.querySelector<HTMLElement>("[data-key]");
      const steps = Array.from(root.querySelectorAll<HTMLElement>("[data-step]"));
      if (!key) return;
      const from = { yPercent: -150, rotation: 0, opacity: 0 };
      const to = { yPercent: 0, rotation: 90, opacity: 1 };
      gsap.set(key, from);
      root.dataset.pinned = "true";
      const light = (p: number) => {
        steps.forEach((el, i) => { el.dataset.on = p >= i / steps.length - 0.001 ? "true" : "false"; });
      };
      light(0);
      const tl = gsap.timeline({ defaults: { ease: "power2.inOut" } });
      tl.fromTo(key, from, to);
      const st = ScrollTrigger.create({
        trigger: root,
        start: "top top",
        end: () => `+=${window.innerHeight * 2}`,
        pin: true,
        scrub: 0.6,
        invalidateOnRefresh: true,
        animation: tl,
        onUpdate: (self) => light(self.progress),
      });
      // Fonts change the layout after first paint; re-measure so the pin length matches the screen.
      void document.fonts?.ready.then(() => ScrollTrigger.refresh());
      return () => {
        st.kill(true);
        tl.kill();
        gsap.set(key, { clearProps: "transform,opacity" });
        delete root.dataset.pinned;
        steps.forEach((el) => { delete el.dataset.on; });
      };
    });
    return () => mm.revert();
  }, []);
  return <section ref={ref} id={id} className={className} aria-labelledby={labelledBy}>{children}</section>;
}
