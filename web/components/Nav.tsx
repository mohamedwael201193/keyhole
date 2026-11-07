"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { KeyholeLogo } from "./KeyholeLogo";
import { MusicToggle } from "./MusicToggle";
import { AccountControl } from "./AccountControl";
import { useI18n } from "@/lib/i18n";

/** Top bar: the audience's first need (judge path) and the core loop. The logo links home. */
const PRIMARY = [
  ["/judge", "judge"],
  ["/vault", "vault"],
  ["/mint", "mint"],
  ["/verify", "verify"],
  ["/settle", "settle"],
] as const;

/** Everything else lives behind "More" (desktop) and in the burger list (mobile). */
const MORE = [
  ["/gallery", "gallery"],
  ["/demo", "demo"],
  ["/ask", "ask"],
  ["/atlas", "atlas"],
  ["/identity", "identity"],
  ["/start", "start"],
] as const;

export function Nav() {
  const { t } = useI18n();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = document.querySelector("nav.nav");
    if (!el) return;
    const tick = () => {
      const on = [...document.querySelectorAll("[data-dark]")].some((s) => {
        const r = s.getBoundingClientRect();
        return r.top <= 72 && r.bottom >= 72;
      });
      el.classList.toggle("dark", on);
      setDark(on);
    };
    tick();
    addEventListener("scroll", tick, { passive: true });
    addEventListener("resize", tick);
    return () => { removeEventListener("scroll", tick); removeEventListener("resize", tick); };
  }, [path]);
  useEffect(() => { setMore(false); setOpen(false); }, [path]);
  // "More" is a disclosure: Escape and an outside click close it, and Escape returns focus to its button.
  useEffect(() => {
    if (!more) return;
    const onPointer = (e: PointerEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMore(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setMore(false); moreBtn.current?.focus(); } };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [more]);
  const current = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only">{t("nav.skip")}</a>
      <nav className={`nav${open ? " open" : ""}`} aria-label="Main">
        <Link href="/" className="brand"><KeyholeLogo className="h-9" tone={dark ? "light" : "ink"} /></Link>
        <div className="links">
          {PRIMARY.map(([href, key]) => (
            <Link key={key} href={href} aria-current={current(href) ? "page" : undefined} className={current(href) ? "on" : ""}>{t(`nav.${key}`)}</Link>
          ))}
          <div className="more" ref={moreRef}>
            <button ref={moreBtn} type="button" className={`more-btn${MORE.some(([href]) => current(href)) ? " on" : ""}`} aria-expanded={more} aria-controls="more-menu" onClick={() => setMore((v) => !v)} data-testid="nav-more">{t("nav.more")}</button>
            <ul id="more-menu" className="more-menu" data-testid="more-menu" hidden={!more}>
              {MORE.map(([href, key]) => (
                <li key={key}><Link href={href} aria-current={current(href) ? "page" : undefined}>{t(`nav.${key}`)}</Link></li>
              ))}
              <li className="more-music"><MusicToggle /></li>
            </ul>
          </div>
        </div>
        <div className="nav-tools">
          <AccountControl />
          <button className="burger" aria-expanded={open} aria-controls="mnav" aria-label={t("nav.menu")} onClick={() => setOpen((v) => !v)}>
            <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
      </nav>
      {open && (
        <ul id="mnav" className="mnav">
          {[...PRIMARY, ...MORE].map(([href, key]) => <li key={key}><Link onClick={() => setOpen(false)} href={href} aria-current={current(href) ? "page" : undefined}>{t(`nav.${key}`)}</Link></li>)}
          <li><MusicToggle /></li>
        </ul>
      )}
    </>
  );
}
