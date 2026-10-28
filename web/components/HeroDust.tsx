"use client";

import { useEffect, useRef } from "react";

type Mote = { x: number; y: number; r: number; v: number; ph: number };

/**
 * hero_2: a warm halo and a soft gold beam behind the key, plus fine dust
 * that rises and drifts. Pauses off-screen, caps device pixel ratio, and
 * draws a single still frame when motion is reduced.
 */
export function HeroDust() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const hero = canvas?.parentElement;
    if (!canvas || !hero) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduce = () =>
      matchMedia("(prefers-reduced-motion: reduce)").matches
      || document.documentElement.classList.contains("no-motion");

    const dprCap = 1.5;
    let w = 0;
    let h = 0;
    let cx = 0;
    let cy = 0;
    let motes: Mote[] = [];
    let raf = 0;
    let visible = true;
    let running = false;

    const place = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      // Measure the hero without the canvas, so a bitmap size can never stretch the section.
      const prev = canvas.style.display;
      canvas.style.display = "none";
      w = hero.clientWidth;
      h = hero.clientHeight;
      canvas.style.display = prev;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const stage = hero.querySelector(".stage");
      if (stage) {
        const sr = stage.getBoundingClientRect();
        const hr = hero.getBoundingClientRect();
        cx = sr.left - hr.left + sr.width / 2;
        cy = sr.top - hr.top + sr.height * 0.46;
      } else {
        cx = w * 0.72;
        cy = h * 0.42;
      }
    };

    const seed = () => {
      const n = 140;
      motes = Array.from({ length: n }, () => ({
        x: cx + (Math.random() - 0.5) * Math.min(680, w * 0.55),
        y: Math.random() * h,
        r: 0.6 + Math.random() * 2.1,
        v: 0.15 + Math.random() * 0.4,
        ph: Math.random() * 6.28,
      }));
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const halo = ctx.createRadialGradient(cx, cy, 20, cx, cy, 520);
      halo.addColorStop(0, "rgba(255,244,214,.85)");
      halo.addColorStop(0.5, "rgba(243,222,170,.28)");
      halo.addColorStop(1, "rgba(236,230,218,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.globalAlpha = reduce() ? 0.1 : 0.1 + 0.03 * Math.sin(t * 0.6);
      ctx.fillStyle = "#F3D27A";
      ctx.beginPath();
      ctx.moveTo(cx - 90, 0);
      ctx.lineTo(cx + 90, 0);
      ctx.lineTo(cx + 330, h);
      ctx.lineTo(cx - 330, h);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      for (const p of motes) {
        if (!reduce()) {
          p.y -= p.v;
          p.x += Math.sin(t * 0.5 + p.ph) * 0.25;
          if (p.y < -6) p.y = h + 6;
        }
        const dx = Math.abs(p.x - cx) / 360;
        const twinkle = reduce() ? 0.55 : 0.45 + 0.4 * Math.sin(t * 1.3 + p.ph);
        const a = Math.max(0, 1 - dx) * twinkle;
        ctx.fillStyle = `rgba(154,116,32,${a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const loop = (now: number) => {
      if (!running) return;
      draw(now / 1000);
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (running || reduce() || !visible) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };

    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    place();
    seed();
    draw(0);
    start();

    const ro = new ResizeObserver(() => {
      place();
      if (!running) draw(0);
    });
    ro.observe(hero);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
      else stop();
    }, { threshold: 0 });
    io.observe(hero);

    const onVis = () => {
      if (document.hidden) stop();
      else if (visible) start();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return <canvas ref={ref} className="hero-dust" aria-hidden="true" />;
}
