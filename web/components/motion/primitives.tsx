"use client";
/**
 * Motion primitives for the design system v2. Every one renders its final state on the server and without JavaScript.
 * Entrance motion is an enhancement: it starts only after hydration, only when the element is on screen, and never under
 * prefers-reduced-motion. Transforms and opacity only, except the glow, which is a box-shadow.
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode, type PointerEvent, type RefObject } from "react";
import { animate, motion, stagger, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
const EASE_OUT: [number, number, number, number] = [0.22, 0.61, 0.36, 1];

function clearInline(el: HTMLElement) {
  el.style.removeProperty("opacity");
  el.style.removeProperty("transform");
}

/**
 * `prepare` hides the element (after hydration only). `play` runs once it is on screen, or at once when it already is.
 * Off under reduced motion: the element is never hidden.
 */
function useRevealOnView(ref: RefObject<HTMLElement | null>, prepare: (el: HTMLElement) => void, play: (el: HTMLElement) => void) {
  const reduce = useReducedMotion();
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || reduce) return;
    const show = () => { prepare(el); play(el); };
    if (!("IntersectionObserver" in window)) { show(); return; }
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) { show(); return; }
    let io: IntersectionObserver | null = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io?.disconnect(); io = null; show(); }
    }, { rootMargin: "0px 0px -8% 0px" });
    prepare(el);
    io.observe(el);
    return () => { io?.disconnect(); io = null; };
  }, [reduce]);
}

/** Fades in and rises by `y` px once on screen. */
export function FadeUp({ children, delay = 0, y = 14, duration = 0.6, className, testid }: {
  children?: ReactNode; delay?: number; y?: number; duration?: number; className?: string; testid?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useRevealOnView(
    ref,
    (el) => { el.style.opacity = "0"; el.style.transform = `translateY(${y}px)`; },
    (el) => { void animate(el, { opacity: [0, 1], y: [y, 0] }, { duration, delay, ease: EASE_OUT }).finished.then(() => clearInline(el)); },
  );
  return <div ref={ref} className={className} data-testid={testid}>{children}</div>;
}

/** Animates the direct children of this element in sequence, `gap` seconds apart, once on screen. */
export function Stagger({ children, gap = 0.08, delay = 0, y = 14, className, testid }: {
  children?: ReactNode; gap?: number; delay?: number; y?: number; className?: string; testid?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useRevealOnView(
    ref,
    (el) => { Array.from(el.children).forEach((c) => { (c as HTMLElement).style.opacity = "0"; (c as HTMLElement).style.transform = `translateY(${y}px)`; }); },
    (el) => {
      const kids = Array.from(el.children) as HTMLElement[];
      void animate(kids, { opacity: [0, 1], y: [y, 0] }, { duration: 0.6, delay: stagger(gap, { startDelay: delay }), ease: EASE_OUT })
        .finished.then(() => kids.forEach(clearInline));
    },
  );
  return <div ref={ref} className={className} data-testid={testid}>{children}</div>;
}

/**
 * Scroll-linked parallax: the inner layer moves by up to `speed` x 100 px over the element's time on screen.
 * The frame clips it. Give the frame room (padding or an oversized layer) so the layer does not reveal an edge.
 */
export function Parallax({ children, speed = 0.15, className, testid }: {
  children?: ReactNode; speed?: number; className?: string; testid?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [`${-speed * 100}px`, `${speed * 100}px`]);
  return (
    <div ref={ref} className={`kh-parallax ${className ?? ""}`.trim()} data-testid={testid}>
      <motion.div className="kh-parallax-layer" style={reduce ? undefined : { y }}>{children}</motion.div>
    </div>
  );
}

/**
 * Pointer tilt with a glow that follows the cursor. Mouse only: touch input and reduced motion get the flat element.
 * Keyboard and screen readers are unaffected (no state, no focus change).
 */
export function Tilt({ children, max = 8, className, testid }: {
  children?: ReactNode; max?: number; className?: string; testid?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const rx = useSpring(0, { stiffness: 260, damping: 26 });
  const ry = useSpring(0, { stiffness: 260, damping: 26 });

  function onMove(e: PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el || reduce || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    ry.set((px - 0.5) * 2 * max);
    rx.set(-(py - 0.5) * 2 * max);
    el.style.setProperty("--tilt-x", `${(px * 100).toFixed(1)}%`);
    el.style.setProperty("--tilt-y", `${(py * 100).toFixed(1)}%`);
  }
  function onLeave() { rx.set(0); ry.set(0); }

  return (
    <motion.div
      ref={ref}
      className={`kh-tilt ${className ?? ""}`.trim()}
      data-tilt="on"
      data-testid={testid}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      style={reduce ? undefined : { rotateX: rx, rotateY: ry, transformPerspective: 900 }}
    >
      {children}
    </motion.div>
  );
}

/** A teal shadow that settles in once the block is on screen. The content is never hidden. */
export function GlowReveal({ children, className, testid }: { children?: ReactNode; className?: string; testid?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useRevealOnView(ref, () => {}, (el) => { el.dataset.in = "true"; });
  return <div ref={ref} className={`kh-glow ${className ?? ""}`.trim()} data-in="false" data-testid={testid}>{children}</div>;
}

/**
 * Counts up to a REAL number passed in (never a placeholder). The server and the first client render show the final value;
 * the count runs on mount and is skipped under reduced motion.
 */
export function CountUp({ value, duration = 1.2, decimals = 0, className, testid }: {
  value: number; duration?: number; decimals?: number; className?: string; testid?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  // The shown text is written straight to the node, so the first paint and the server markup are both the final value.
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || reduce || !Number.isFinite(value)) { if (el) el.textContent = fmt(value); return; }
    const controls = animate(0, value, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => { el.textContent = fmt(v); },
    });
    return () => controls.stop();
  }, [value, duration, decimals, reduce]);
  return (
    <span ref={ref} className={`kh-count ${className ?? ""}`.trim()} data-testid={testid} data-value={value}>{fmt(value)}</span>
  );
}
