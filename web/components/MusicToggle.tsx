"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";

/** Optional ambient loop. Off by default; starts only on an explicit click (autoplay-safe). Track: self-generated, CC0. */
export function MusicToggle() {
  const { t } = useI18n();
  const [on, setOn] = useState(false);
  const a = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { a.current?.pause(); }, []);
  const toggle = async () => {
    if (!a.current) { a.current = new Audio("/audio/ambient.mp3"); a.current.loop = true; a.current.volume = 0; }
    const el = a.current;
    if (on) { fade(el, 0, () => el.pause()); setOn(false); return; }
    try { await el.play(); fade(el, 0.35); setOn(true); } catch { setOn(false); }
  };
  return (
    <button type="button" onClick={toggle} aria-pressed={on} aria-label={on ? t("music.on") : t("music.off")} title={on ? t("music.on") : t("music.off")}
      className="grid h-11 w-11 place-items-center rounded border border-line hover:border-signal">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={on ? "#00ec97" : "#8a9590"} strokeWidth="1.6" aria-hidden="true">
        <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2">{on && <animate attributeName="opacity" values="1;.4;1" dur="1.6s" repeatCount="indefinite" />}</path>
      </svg>
    </button>
  );
}
function fade(el: HTMLAudioElement, to: number, done?: () => void) {
  const from = el.volume, t0 = performance.now();
  const step = () => { const k = Math.min(1, (performance.now() - t0) / 900); el.volume = from + (to - from) * k; if (k < 1) requestAnimationFrame(step); else done?.(); };
  step();
}
