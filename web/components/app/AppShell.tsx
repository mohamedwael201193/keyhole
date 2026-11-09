"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { KeyholeLogo } from "@/components/KeyholeLogo";
import { AccountControl } from "@/components/AccountControl";
import { TxLink } from "@/components/TxLink";
import { KEYS_CONTRACT } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { KeyStoreProvider, useKeyStore } from "@/lib/keyStore";
import { useWallet } from "@/lib/wallet";
import { SessionPill } from "./SessionPill";

/**
 * The app shell for the holder routes. One top bar across the full width (logo, page title, network pill, account), then a
 * sidebar and the page on desktop. On phones the sidebar is a menu sheet and five tabs sit at the bottom (Overview, Swap,
 * Vault, Keys, More). There is no site footer in the app: the legal line lives at the foot of the sidebar.
 * The URLs do not change; components/SiteFrame.tsx picks this shell for these routes and the public bar for every other route.
 */

/** Routes that render inside the shell (exact path or a sub-path). */
export const APP_ROUTES = ["/dashboard", "/swap", "/keys", "/gallery", "/key", "/settle", "/vault", "/mint", "/pnl"] as const;

export function isAppRoute(path: string | null | undefined): boolean {
  if (!path) return false;
  return APP_ROUTES.some((r) => path === r || path.startsWith(r + "/"));
}

export type AppIcon = "home" | "key" | "swap" | "vault" | "activity";
export type AppNavItem = {
  /** Stable id for tests and styling. */
  id: string;
  label: string;
  href: string;
  icon: AppIcon;
  /** Path prefixes that light this item up. */
  match: readonly string[];
  /** Only active when the URL hash is this (for example #activity on /dashboard). */
  hash?: string;
  /** Not active when the URL hash is this (Overview yields to Activity). */
  notHash?: string;
};
export type AppNavGroup = { title: string; items: AppNavItem[] };

/**
 * Overview, Swap, Vault, Keys and Activity. Mint lives inside Keys (it is reached from the keys page), so Keys stays lit
 * on /mint. The bottom tabs are the first four of these.
 */
export const APP_NAV: AppNavGroup[] = [
  {
    title: "Workspace",
    items: [
      { id: "overview", label: "Overview", href: "/dashboard", icon: "home", match: ["/dashboard"] },
      { id: "swap", label: "Swap", href: "/swap", icon: "swap", match: ["/swap"] },
      { id: "vault", label: "Vault", href: "/vault", icon: "vault", match: ["/vault", "/pnl"] },
      { id: "keys", label: "Keys", href: "/keys", icon: "key", match: ["/keys", "/gallery", "/key", "/mint"] },
      { id: "activity", label: "Activity", href: "/settle", icon: "activity", match: ["/settle"] },
    ],
  },
];

const TAB_IDS = ["overview", "swap", "vault", "keys"] as const;

/** Whether a nav item is the current page. Pure, so the active state is unit-tested. */
export function isItemActive(item: AppNavItem, pathname: string | null | undefined, hash: string): boolean {
  if (!pathname) return false;
  if (!item.match.some((m) => pathname === m || pathname.startsWith(m + "/"))) return false;
  if (item.hash) return hash === item.hash;
  if (item.notHash && hash === item.notHash) return false;
  return true;
}

/** The title shown in the top bar for a route. Pure. */
const TITLES: [string, string][] = [
  ["/dashboard", "Overview"], ["/swap", "Swap"], ["/settle", "Activity"], ["/vault", "Vault"], ["/pnl", "Vault statement"],
  ["/keys", "Keys"], ["/gallery", "Keys"], ["/key", "Key"], ["/mint", "Mint"],
];
export function pageTitle(path: string | null | undefined): string {
  if (!path) return "KEYHOLE";
  const hit = TITLES.find(([p]) => path === p || path.startsWith(p + "/"));
  return hit ? hit[1] : "KEYHOLE";
}

const ICON: Record<AppIcon, ReactNode> = {
  home: <path d="M3.5 10.5 12 3.5l8.5 7V20a.5.5 0 0 1-.5.5h-5v-6h-6v6H4a.5.5 0 0 1-.5-.5z" />,
  key: <><circle cx="8" cy="12" r="3.6" /><path d="M11.6 12H21M18 12v3.2M21 12v2.4" /></>,
  swap: <path d="M7 4v15.5M7 19.5 3.5 16M7 19.5 10.5 16M17 20V4.5M17 4.5 13.5 8M17 4.5 20.5 8" />,
  vault: <><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><circle cx="12" cy="12" r="3" /></>,
  activity: <path d="M3 12.5h4l2.6-6.5 4.2 13 2.6-6.5H21" />,
};

export function AppNavIcon({ name }: { name: AppIcon }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICON[name]}
    </svg>
  );
}

/** The sidebar list (and the phone menu, which is the same list). Pure of hooks, so markup and active state render alone. */
export function AppNav({ pathname, hash, mint = false, onNavigate }: { pathname: string | null | undefined; hash: string; mint?: boolean; onNavigate?: (href: string) => void }) {
  return (
    <nav aria-label="App navigation" className="app-nav">
      {APP_NAV.map((group) => (
        <div className="app-group" key={group.title}>
          <ul>
            {group.items.map((item) => {
              const on = isItemActive(item, pathname, hash);
              return (
                <Fragment key={item.id}>
                  <li>
                    <Link
                      href={item.href}
                      className={`app-link${on ? " on" : ""}`}
                      aria-current={on ? "page" : undefined}
                      data-testid={`app-nav-${item.id}`}
                      onClick={() => onNavigate?.(item.href)}
                    >
                      <AppNavIcon name={item.icon} />
                      <span>{item.label}</span>
                    </Link>
                  </li>
                  {mint && item.id === "keys" && (
                    <li>
                      <Link href="/mint" className="app-link app-link-cta" data-testid="app-nav-mint" onClick={() => onNavigate?.("/mint")}>
                        <AppNavIcon name="key" />
                        <span>Mint a key</span>
                      </Link>
                    </li>
                  )}
                </Fragment>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** The four tabs on phones, plus the More button that opens the menu. */
export function AppTabs({ pathname, hash, onMore, moreOpen }: { pathname: string | null | undefined; hash: string; onMore: () => void; moreOpen: boolean }) {
  const items = APP_NAV.flatMap((g) => g.items).filter((i) => (TAB_IDS as readonly string[]).includes(i.id));
  return (
    <nav aria-label="App tabs" className="app-tabs">
      {items.map((item) => {
        const on = isItemActive(item, pathname, hash);
        return (
          <Link key={item.id} href={item.href} className={`app-tab${on ? " on" : ""}`} aria-current={on ? "page" : undefined} data-testid={`app-tab-${item.id}`}>
            <AppNavIcon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        );
      })}
      <button type="button" className={`app-tab${moreOpen ? " on" : ""}`} aria-expanded={moreOpen} aria-controls="app-side" onClick={onMore} data-testid="app-burger">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M5 12h.01M12 12h.01M19 12h.01" /></svg>
        <span>More</span>
      </button>
    </nav>
  );
}

/** "/dashboard#activity" → "#activity"; a link without a hash → "". */
export const hashOf = (href: string) => (href.includes("#") ? href.slice(href.indexOf("#")) : "");

/** The shell with the shared key store mounted once for every app route (the store persists across client navigation). */
export function AppShell({ children }: { children: ReactNode }) {
  return <KeyStoreProvider><AppShellFrame>{children}</AppShellFrame></KeyStoreProvider>;
}

function AppShellFrame({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const { accountId } = useWallet();
  const keys = useKeyStore();
  // Mint shows in the sidebar only when the key store has read this account and found no key.
  const mint = !!accountId && keys.status === "ready" && keys.keys.length === 0;
  const [hash, setHash] = useState("");
  const [open, setOpen] = useState(false);

  // The hash is not part of usePathname(), and a client link to the same page does not fire hashchange. Read it on
  // route change, on back and forward, and when a shell link is pressed (onNavigate below).
  useEffect(() => {
    const read = () => setHash(location.hash);
    read();
    addEventListener("hashchange", read);
    addEventListener("popstate", read);
    return () => { removeEventListener("hashchange", read); removeEventListener("popstate", read); };
  }, [pathname]);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="app" data-testid="app-shell">
      <a href="#main" className="sr-only focus:not-sr-only app-skip">{t("nav.skip")}</a>
      <header className="app-top">
        <Link href="/" className="brand app-brand" aria-label="KEYHOLE home">
          <KeyholeLogo className="h-9" tone="ink" />
        </Link>
        <p className="app-title" data-testid="app-title">{pageTitle(pathname)}</p>
        <div className="app-top-end">
          <span className="app-net" data-testid="network-pill"><i aria-hidden="true" />NEAR mainnet</span>
          <SessionPill />
          <AccountControl />
        </div>
      </header>
      <div className="app-body">
        <aside id="app-side" className={`app-side${open ? " open" : ""}`} aria-label="App">
          <AppNav pathname={pathname} hash={hash} mint={mint} onNavigate={(href) => { setHash(hashOf(href)); setOpen(false); }} />
          <div className="app-foot">
            <p className="app-net-line"><i aria-hidden="true" />NEAR mainnet</p>
            <Link href="/" className="app-back" data-testid="app-back">← Back to site</Link>
            <Link href="/verify" className="app-proof" data-testid="app-proof">Proof</Link>
            <p className="app-legal">
              <a href="https://near.org" target="_blank" rel="noreferrer">Built on NEAR</a>
              <span aria-hidden="true"> · </span>
              <TxLink account={KEYS_CONTRACT}>{KEYS_CONTRACT}</TxLink>
            </p>
          </div>
        </aside>
        <main id="main" className="app-main" tabIndex={-1}>{children}</main>
      </div>
      <AppTabs pathname={pathname} hash={hash} moreOpen={open} onMore={() => setOpen((v) => !v)} />
    </div>
  );
}
