"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { KeyholeLogo } from "./KeyholeLogo";
import { AccountControl } from "./AccountControl";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

/**
 * Public top bar: the logo (home), the judge path, Verify, one primary action (Open app) and Connect.
 * Everything else lives in the footer (components/Footer.tsx). The app shell has its own bar (components/app/AppShell.tsx).
 */
const LINKS = [
  ["/judge", "judge"],
  ["/verify", "verify"],
] as const;

const OPEN_APP = ["/dashboard", "openApp"] as const;

export function Nav() {
  const { t } = useI18n();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
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
  useEffect(() => { setOpen(false); }, [path]);
  const current = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only">{t("nav.skip")}</a>
      <nav className={`nav${open ? " open" : ""}`} aria-label="Main">
        <Link href="/" className="brand"><KeyholeLogo className="h-9" tone={dark ? "light" : "ink"} /></Link>
        <div className="links">
          {LINKS.map(([href, key]) => (
            <Link key={key} href={href} aria-current={current(href) ? "page" : undefined} className={current(href) ? "on" : ""}>{t(`nav.${key}`)}</Link>
          ))}
        </div>
        <div className="nav-tools">
          <Button href={OPEN_APP[0]} size="sm" className="nav-open" testid="open-app">{t(`nav.${OPEN_APP[1]}`)}</Button>
          <AccountControl />
          <button className="burger" aria-expanded={open} aria-controls="mnav" aria-label={t("nav.menu")} onClick={() => setOpen((v) => !v)}>
            <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
      </nav>
      {open && (
        <ul id="mnav" className="mnav">
          {[...LINKS, OPEN_APP].map(([href, key]) => <li key={key}><Link onClick={() => setOpen(false)} href={href} aria-current={current(href) ? "page" : undefined}>{t(`nav.${key}`)}</Link></li>)}
        </ul>
      )}
    </>
  );
}
