"use client";
/**
 * Motion helpers for the landing. There is no scroll pin and no animation library here: every effect is a CSS keyframe, switched on
 * by a data attribute these hooks set. The server and a browser without script render the final, readable state. Everything is off
 * under prefers-reduced-motion, html.no-motion and ?static (the same switch as HomeMotion).
 */
import { useEffect, useState, type RefObject } from "react";

/** True when decorative motion must not run: reduced motion, `?static`, or html.no-motion. Client only. */
export function motionOff(): boolean {
  return (
    new URLSearchParams(location.search).has("static") ||
    document.documentElement.classList.contains("no-motion") ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export type Dealt = "rest" | "armed" | "on";

/**
 * A dealt moment that plays once. "rest" is the final state (server, no script, reduced motion). With motion allowed it goes to
 * "armed" (the first frame, drawn hidden) and to "on" (the keyframes run) the first time the section is 35% in view.
 */
export function useDealt(ref: RefObject<HTMLElement | null>, threshold = 0.35): Dealt {
  const [state, setState] = useState<Dealt>("rest");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (motionOff() || !("IntersectionObserver" in window)) return;
    setState("armed");
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setState("on"); io.disconnect(); }
    }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, threshold]);
  return state;
}

/**
 * A loop that runs only while its section is in view, motion is allowed and the visitor has not paused it.
 * `running` is false on the server and under reduced motion, so the page rests in its final state.
 */
export function useLoop(ref: RefObject<HTMLElement | null>): { running: boolean; paused: boolean; toggle: () => void } {
  const [inView, setInView] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (motionOff() || !("IntersectionObserver" in window)) return;
    setAllowed(true);
    const io = new IntersectionObserver((entries) => setInView(entries.some((e) => e.isIntersecting)), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return { running: allowed && inView && !paused, paused, toggle: () => setPaused((p) => !p) };
}
