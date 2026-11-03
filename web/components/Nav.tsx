"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { KeyholeLogo } from "./KeyholeLogo";
import { MusicToggle } from "./MusicToggle";
import { useI18n } from "@/lib/i18n";
import { useWallet } from "@/lib/wallet";
import { pillAccount, shortAccount } from "@/lib/near";
import { acct } from "@/lib/config";
import { copyText } from "@/lib/copyText";

const LINKS = [
  ["/", "home"],
  ["/vault", "vault"],
  ["/mint", "mint"],
  ["/verify", "verify"],
  ["/settle", "settle"],
  ["/gallery", "gallery"],
  ["/judge", "judge"],
] as const;

export function Nav() {
  const { t } = useI18n();
  const { accountId, connect, disconnect } = useWallet();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  // The server renders Connect disabled; it becomes clickable only once React owns it, so an early tap
  // can never land on a button with no handler (the mobile first-click flake).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const acctRef = useRef<HTMLDivElement>(null);
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
  useEffect(() => { setMenu(false); }, [path]);
  useEffect(() => {
    if (!menu) return;
    const onPointer = (e: PointerEvent) => { if (!acctRef.current?.contains(e.target as Node)) setMenu(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [menu]);
  const copyAccount = async () => {
    if (!accountId) return;
    await copyText(accountId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
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
            ? <div className="acct" ref={acctRef}>
                <button type="button" className="cw" aria-expanded={menu} aria-controls="acct-menu" data-testid="account" onClick={() => setMenu((v) => !v)} title={accountId}><span className="cw-full">{shortAccount(accountId, 4)}</span><span className="cw-short">{pillAccount(accountId)}</span></button>
                {menu && (
                  <div id="acct-menu" className="acct-menu" role="menu" data-testid="account-menu">
                    <p className="id" data-testid="account-id">{accountId}</p>
                    <button type="button" role="menuitem" onClick={() => void copyAccount()}>{copied ? t("nav.copied") : t("nav.copy")}</button>
                    <a role="menuitem" href={acct(accountId)} target="_blank" rel="noreferrer">{t("nav.explorer")}</a>
                    <button type="button" role="menuitem" onClick={() => { setMenu(false); void disconnect(); }}>{t("nav.disconnect")}</button>
                  </div>
                )}
              </div>
            : <button type="button" className="cw" onClick={() => void connect()} disabled={!hydrated} data-hydrated={hydrated ? "1" : "0"} data-testid="connect">{t("nav.connect")}</button>}
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
