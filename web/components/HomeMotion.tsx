"use client";
import { useEffect } from "react";

/**
 * Light landing motion: CSS hero entrance (heirloom.css), scroll reveal with IntersectionObserver
 * (fade + slide-up, staggered per group), a slow float on the art and a small parallax on the hero key.
 * Only elements below the fold at mount are hidden, so nothing on screen ever blanks. A fallback timer
 * reveals everything if the observer never fires. Off for prefers-reduced-motion and ?static.
 */
const GROUPS = [".sec .eb", ".sec h2", ".sec .lead", ".story .st", ".priv .pvc", ".encl .ph", ".attc", ".safe .card", ".cg .c", ".tc", ".gk", ".term", ".cta .keys img"];

export function HomeMotion() {
  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stat = new URLSearchParams(location.search).has("static");
    const root = document.documentElement;
    const counters = () => document.querySelectorAll<HTMLElement>("[data-count]").forEach((e) => { e.textContent = (+(e.dataset.count || 0)).toFixed(+(e.dataset.dec || 0)); });
    if (reduce || stat) { root.classList.add("no-motion"); counters(); return () => root.classList.remove("no-motion"); }
    let dead = false;
    const t0 = performance.now() + 500;
    const count = (now: number) => {
      if (dead) return;
      const p = Math.max(0, Math.min(1, (now - t0) / 1600));
      const ease = 1 - Math.pow(1 - p, 3);
      document.querySelectorAll<HTMLElement>("[data-count]").forEach((e) => { e.textContent = (+(e.dataset.count || 0) * ease).toFixed(+(e.dataset.dec || 0)); });
      if (p < 1) requestAnimationFrame(count);
    };
    requestAnimationFrame(count);

    const vh = innerHeight || 800;
    const hidden: HTMLElement[] = [];
    for (const sel of GROUPS) {
      const byParent = new Map<Element | null, number>();
      document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
        if (el.classList.contains("rv") && hidden.includes(el)) return;
        if (el.getBoundingClientRect().top < vh * 0.92) return; // already on screen: leave it
        const i = byParent.get(el.parentElement) ?? 0;
        byParent.set(el.parentElement, i + 1);
        el.classList.add("rv");
        el.style.setProperty("--rd", `${Math.min(i, 6) * 0.09}s`);
        hidden.push(el);
      });
    }
    root.classList.add("rv-on");
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    hidden.forEach((el) => io.observe(el));
    const fallback = window.setTimeout(() => hidden.forEach((el) => el.classList.add("in")), 20000);

    const key = document.querySelector<HTMLElement>(".hkey");
    let ticking = false;
    const onScroll = () => {
      if (ticking || !key) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; const y = Math.min(scrollY, 900); key.style.translate = `0 ${(-y * 0.08).toFixed(1)}px`; });
    };
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      dead = true; io.disconnect(); clearTimeout(fallback); removeEventListener("scroll", onScroll);
      root.classList.remove("rv-on");
      hidden.forEach((el) => { el.classList.remove("rv", "in"); el.style.removeProperty("--rd"); });
    };
  }, []);
  return null;
}
