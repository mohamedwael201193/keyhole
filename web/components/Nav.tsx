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
  const { accountId, connect, disconnect, restoring, mismatch } = useWallet();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
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
  useEffect(() => { setMenu(false); setMore(false); setOpen(false); }, [path]);
  // "More" is a disclosure: Escape and an outside click close it, and Escape returns focus to its button.
  useEffect(() => {
    if (!more) return;
    const onPointer = (e: PointerEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMore(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setMore(false); moreBtn.current?.focus(); } };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [more]);
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
          {accountId
            ? <div className="acct" ref={acctRef}>
                {mismatch && <button type="button" className="cw warn" data-testid="wallet-mismatch" title={`MetaMask is on ${mismatch}, but this site is connected as ${accountId}. Reconnect to switch.`} onClick={() => { void disconnect().then(() => connect()); }}>MetaMask switched · reconnect</button>}
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
            : restoring
            ? <button type="button" className="cw" disabled data-testid="wallet-restoring" aria-busy="true">{t("nav.connect")}</button>
            : <button type="button" className="cw" onClick={() => void connect()} disabled={!hydrated} data-hydrated={hydrated ? "1" : "0"} data-testid="connect">{t("nav.connect")}</button>}
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
