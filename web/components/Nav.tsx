"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { KeyholeLogo } from "./KeyholeLogo";
import { MusicToggle } from "./MusicToggle";
import { useI18n, LOCALES, type Locale } from "@/lib/i18n";
import { useWallet } from "@/lib/wallet";
import { shortAccount } from "@/lib/near";

const LINKS = ["atlas", "vault", "mint", "gallery", "verify"] as const;
export function Nav() {
  const { t, locale, setLocale } = useI18n();
  const { accountId, connect, disconnect } = useWallet();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink/85 backdrop-blur">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:bg-signal focus:px-3 focus:py-2 focus:text-ink">{t("nav.skip")}</a>
      <nav className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4" aria-label="Main">
        <Link href="/" className="flex min-h-11 items-center"><KeyholeLogo size={30} /></Link>
        <ul className="ms-auto hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <li key={l}><Link href={`/${l}`} aria-current={path === `/${l}` ? "page" : undefined}
              className={`inline-flex min-h-11 items-center px-3 font-mono text-[12px] tracking-wider ${path === `/${l}` ? "text-signal" : "text-zinc-300 hover:text-white"}`}>{t(`nav.${l}`)}</Link></li>
          ))}
        </ul>
        <span className="hidden rounded border border-signal/60 px-2 py-1 font-mono text-[11px] text-signal lg:inline">{t("nav.badge")}</span>
        <div className="ms-auto flex items-center gap-2 md:ms-0">
          <label className="sr-only" htmlFor="lang">Language</label>
          <select id="lang" value={locale} onChange={(e) => setLocale(e.target.value as Locale)} className="h-11 rounded border border-line bg-ink px-2 font-mono text-xs">
            {Object.entries(LOCALES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <MusicToggle />
          {accountId
            ? <button className="btn btn-ghost hidden font-mono text-xs sm:inline-flex" onClick={() => void disconnect()} title={t("nav.disconnect")}>{shortAccount(accountId)}</button>
            : <button className="btn btn-signal hidden sm:inline-flex" onClick={connect} data-testid="connect">{t("nav.connect")}</button>}
          <button className="grid h-11 w-11 place-items-center rounded border border-line md:hidden" aria-expanded={open} aria-controls="mnav" aria-label={t("nav.menu")} onClick={() => setOpen(!open)}>
            <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
      </nav>
      {open && (
        <ul id="mnav" className="border-t border-line px-4 pb-3 md:hidden">
          {LINKS.map((l) => <li key={l}><Link onClick={() => setOpen(false)} href={`/${l}`} className="flex min-h-11 items-center font-mono text-sm">{t(`nav.${l}`)}</Link></li>)}
          <li className="pt-2">{accountId
            ? <button className="btn btn-ghost w-full" onClick={() => void disconnect()}>{t("nav.disconnect")} · {shortAccount(accountId)}</button>
            : <button className="btn btn-signal w-full" onClick={connect}>{t("nav.connect")}</button>}</li>
        </ul>
      )}
    </header>
  );
}
