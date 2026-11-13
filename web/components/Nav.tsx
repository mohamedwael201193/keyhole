"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { KeyholeLogo } from "./KeyholeLogo";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

/**
 * Public top bar. Logo (home), How it works, Proof, Holders, Attack, Verification path, Developers, and Launch app.
 * Wallets live in the app. Phones get the same items in a menu list (#mnav). The footer is components/Footer.tsx.
 */
export const SITE_LINKS = [
  { href: "/#handover", label: "How it works", match: "/" },
  { href: "/verify", label: "Proof", match: "/verify" },
  { href: "/holders", label: "Holders", match: "/holders" },
  { href: "/attack", label: "Attack", match: "/attack" },
  { href: "/verify/path", label: "Verification path", match: "/verify/path" },
  { href: "/developers", label: "Developers", match: "/developers" },
] as const;

export const LAUNCH_APP = { href: "/dashboard", label: "Launch app" } as const;

/** The one item that is current for a path: the longest matching prefix, so Proof is not current on /verify/path. */
export function activeMatch(path: string | null | undefined, links: readonly { match: string }[] = SITE_LINKS): string | null {
  if (!path) return null;
  let best: string | null = null;
  for (const l of links) {
    const m = l.match;
    const hit = m === "/" ? path === "/" : path === m || path.startsWith(m + "/");
    if (hit && (best === null || m.length > best.length)) best = m;
  }
  return best;
}

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
  const active = activeMatch(path);
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only">{t("nav.skip")}</a>
      <nav className={`nav${open ? " open" : ""}`} aria-label="Main">
        <Link href="/" className="brand" aria-label="KEYHOLE home"><KeyholeLogo className="h-9" tone={dark ? "light" : "ink"} /></Link>
        <div className="links">
          {SITE_LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={l.match === active ? "page" : undefined} className={l.match === active ? "on" : ""}>{l.label}</Link>
          ))}
        </div>
        <div className="nav-tools">
          <span className="nav-net"><i aria-hidden="true" />NEAR Mainnet</span>
          <Button href={LAUNCH_APP.href} size="sm" className="nav-open" testid="open-app">{LAUNCH_APP.label}</Button>
          <button className="burger" aria-expanded={open} aria-controls="mnav" aria-label={t("nav.menu")} onClick={() => setOpen((v) => !v)}>
            <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
      </nav>
      {open && (
        <ul id="mnav" className="mnav">
          {[...SITE_LINKS, LAUNCH_APP].map((l) => (
            <li key={l.href}><Link onClick={() => setOpen(false)} href={l.href} aria-current={"match" in l && l.match === active ? "page" : undefined}>{l.label}</Link></li>
          ))}
        </ul>
      )}
    </>
  );
}
