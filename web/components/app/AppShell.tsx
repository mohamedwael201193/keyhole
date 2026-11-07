"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { KeyholeLogo } from "@/components/KeyholeLogo";
import { AccountControl } from "@/components/AccountControl";
import { useI18n } from "@/lib/i18n";

/**
 * The app shell for the holder routes: a left sidebar on desktop, a drawer under the top bar on phones, and one top bar
 * with the network pill and the account control. The URLs do not change; components/SiteFrame.tsx picks this shell for
 * these routes and the public top bar for every other route.
 */

/** Routes that render inside the shell (exact path or a sub-path). */
export const APP_ROUTES = ["/dashboard", "/gallery", "/key", "/settle", "/vault", "/mint", "/pnl"] as const;

export function isAppRoute(path: string | null | undefined): boolean {
  if (!path) return false;
  return APP_ROUTES.some((r) => path === r || path.startsWith(r + "/"));
}

export type AppIcon = "home" | "key" | "swap" | "vault" | "mint" | "activity" | "judge" | "verify";
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

export const APP_NAV: AppNavGroup[] = [
  {
    title: "Workspace",
    items: [
      { id: "overview", label: "Overview", href: "/dashboard", icon: "home", match: ["/dashboard"], notHash: "#activity" },
      { id: "mint", label: "Mint", href: "/mint", icon: "mint", match: ["/mint"] },
      { id: "vault", label: "Vault", href: "/vault", icon: "vault", match: ["/vault", "/pnl"] },
      // Trade is the quotes and swaps page (/settle). The signed PnL statement (/pnl) is opened from the vault, so Vault stays current there.
      { id: "swaps", label: "Trade", href: "/settle", icon: "swap", match: ["/settle"] },
      // My keys is the connected account's keys (/gallery?mine=1). The All keys tab on /gallery lists every key on chain.
      { id: "keys", label: "My keys", href: "/gallery?mine=1", icon: "key", match: ["/gallery", "/key"] },
      { id: "activity", label: "Activity", href: "/dashboard#activity", icon: "activity", match: ["/dashboard"], hash: "#activity" },
    ],
  },
  {
    title: "Secondary",
    items: [
      { id: "judge", label: "Judge path", href: "/judge", icon: "judge", match: ["/judge"] },
      { id: "verify", label: "Verify", href: "/verify", icon: "verify", match: ["/verify"] },
    ],
  },
];

/** Whether a nav item is the current page. Pure, so the active state is unit-tested. */
export function isItemActive(item: AppNavItem, pathname: string | null | undefined, hash: string): boolean {
  if (!pathname) return false;
  if (!item.match.some((m) => pathname === m || pathname.startsWith(m + "/"))) return false;
  if (item.hash) return hash === item.hash;
  if (item.notHash && hash === item.notHash) return false;
  return true;
}

const ICON: Record<AppIcon, ReactNode> = {
  home: <path d="M3.5 10.5 12 3.5l8.5 7V20a.5.5 0 0 1-.5.5h-5v-6h-6v6H4a.5.5 0 0 1-.5-.5z" />,
  key: <><circle cx="8" cy="12" r="3.6" /><path d="M11.6 12H21M18 12v3.2M21 12v2.4" /></>,
  swap: <path d="M7 4v15.5M7 19.5 3.5 16M7 19.5 10.5 16M17 20V4.5M17 4.5 13.5 8M17 4.5 20.5 8" />,
  vault: <><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><circle cx="12" cy="12" r="3" /></>,
  mint: <path d="M12 3.5 14.4 9l5.9.5-4.5 3.9 1.4 5.8L12 16.6l-5.2 2.6 1.4-5.8-4.5-3.9L9.6 9z" />,
  activity: <path d="M3 12.5h4l2.6-6.5 4.2 13 2.6-6.5H21" />,
  judge: <path d="M5 12.5l4.2 4.2L19 6.8" />,
  verify: <path d="M12 3.5l7.5 2.8v5.6c0 4.4-3.1 7.9-7.5 8.6-4.4-.7-7.5-4.2-7.5-8.6V6.3z" />,
};

export function AppNavIcon({ name }: { name: AppIcon }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICON[name]}
    </svg>
  );
}

/** The sidebar list. Pure of hooks, so the markup and active state render on their own. */
export function AppNav({ pathname, hash, onNavigate }: { pathname: string | null | undefined; hash: string; onNavigate?: (href: string) => void }) {
  return (
    <nav aria-label="App navigation" className="app-nav">
      {APP_NAV.map((group) => (
        <div className="app-group" key={group.title}>
          <p className="app-group-title" id={`app-group-${group.title.replace(/\W+/g, "-").toLowerCase()}`}>{group.title}</p>
          <ul aria-labelledby={`app-group-${group.title.replace(/\W+/g, "-").toLowerCase()}`}>
            {group.items.map((item) => {
              const on = isItemActive(item, pathname, hash);
              return (
                <li key={item.id}>
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
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** "/dashboard#activity" → "#activity"; a link without a hash → "". */
export const hashOf = (href: string) => (href.includes("#") ? href.slice(href.indexOf("#")) : "");

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [hash, setHash] = useState("");
  const [open, setOpen] = useState(false);
  const burger = useRef<HTMLButtonElement>(null);

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
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); burger.current?.focus(); } };
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
        <div className="app-top-end">
          <span className="app-net" data-testid="network-pill"><i aria-hidden="true" />NEAR mainnet</span>
          <AccountControl />
          <button
            ref={burger}
            type="button"
            className="app-burger"
            aria-expanded={open}
            aria-controls="app-side"
            onClick={() => setOpen((v) => !v)}
            data-testid="app-burger"
          >
            <span>Menu</span>
          </button>
        </div>
      </header>
      <div className="app-body">
        <aside id="app-side" className={`app-side${open ? " open" : ""}`} aria-label="App">
          <p className="app-net-line"><i aria-hidden="true" />NEAR mainnet</p>
          <AppNav pathname={pathname} hash={hash} onNavigate={(href) => { setHash(hashOf(href)); setOpen(false); }} />
          <p className="app-thesis">Hold the key, run the account. Sell it, and the account goes with it.</p>
        </aside>
        <main id="main" className="app-main" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
