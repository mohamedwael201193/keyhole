"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { KeyholeLogo } from "./KeyholeLogo";
import { MusicToggle } from "./MusicToggle";
import { useI18n } from "@/lib/i18n";
import { useWallet } from "@/lib/wallet";
import { shortAccount } from "@/lib/near";

const LINKS = [
  ["/", "home"],
  ["/vault", "vault"],
  ["/mint", "mint"],
  ["/verify", "verify"],
  ["/gallery", "gallery"],
] as const;

export function Nav() {
  const { t } = useI18n();
  const { accountId, connect, disconnect } = useWallet();
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
          <span className="desk"><MusicToggle /></span>
          {accountId
            ? <button className="cw" onClick={() => void disconnect()} title={t("nav.disconnect")}>{shortAccount(accountId, 4)}</button>
            : <button type="button" className="cw" onClick={() => void connect()} data-testid="connect">{t("nav.connect")}</button>}
          <button className="burger" aria-expanded={open} aria-controls="mnav" aria-label={t("nav.menu")} onClick={() => setOpen((v) => !v)}>
            <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
      </nav>
      {open && (
        <ul id="mnav" className="mnav">
          {LINKS.map(([href, key]) => <li key={key}><Link onClick={() => setOpen(false)} href={href}>{t(`nav.${key}`)}</Link></li>)}
          <li><MusicToggle /></li>
        </ul>
      )}
    </>
  );
}
