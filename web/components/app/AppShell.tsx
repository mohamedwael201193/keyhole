"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { navSectionOf, parseSectionHash, sectionHref, SECTION_LABEL, type SectionId } from "@/lib/dashboardSections";
import { useHash } from "@/lib/useHash";
import { KeyholeLogo } from "@/components/KeyholeLogo";
import { AccountControl } from "@/components/AccountControl";
import { TxLink } from "@/components/TxLink";
import { KEYS_CONTRACT, PLEDGE_SANDBOX } from "@/lib/config";
import { networkPillDetail, networkPillLabel } from "@/lib/networkLabel";
import { useI18n } from "@/lib/i18n";
import { KeyStoreProvider } from "@/lib/keyStore";
import { VaultDataProvider } from "@/lib/vaultData";
import { useWallet } from "@/lib/wallet";
import { PayoutPanel } from "@/components/PayoutPanel";
import { SessionPill } from "./SessionPill";

/**
 * The app shell for the holder routes. One top bar across the full width (logo, page title, network pill, account), then a
 * sidebar and the page on desktop. On phones the sidebar is a menu sheet and five tabs sit at the bottom (Overview, Swap,
 * Vault, Keys, More). There is no site footer in the app: the legal line lives at the foot of the sidebar.
 * Everything a holder does is a section of /dashboard (#swap, #vault, #keys, #pledge, #activity, #proof); the sidebar and the tabs
 * link there. The old routes (/swap, /vault, /settle ...) still render the same views in this shell. Developer and verification
 * material (/developers, /verify, /attack) is public and uses the site bar. components/SiteFrame.tsx picks the shell.
 */

/** Routes that render inside the shell (exact path or a sub-path). */
export const APP_ROUTES = ["/dashboard", "/swap", "/keys", "/gallery", "/key", "/settle", "/vault", "/mint", "/pnl", "/pledge"] as const;

export function isAppRoute(path: string | null | undefined): boolean {
  if (!path) return false;
  // The verification path is a public page (no wallet, no sidebar). It sits under /verify, so it is excluded before the prefix loop.
  if (path === "/verify/path" || path.startsWith("/verify/path/")) return false;
  return APP_ROUTES.some((r) => path === r || path.startsWith(r + "/"));
}

export type AppIcon = "home" | "key" | "swap" | "vault" | "activity" | "shield" | "alert" | "pledge";
export type AppNavItem = {
  /** Stable id for tests and styling. */
  id: string;
  label: string;
  href: string;
  icon: AppIcon;
  /** The dashboard section this item opens (/dashboard#section). */
  section: SectionId;
  /** Old route prefixes that light this item up (the same view, rendered on its own route). */
  match: readonly string[];
};
export type AppNavGroup = { title: string; items: AppNavItem[] };

/**
 * Overview, Swap, Vault, Keys, Pledge, Activity and My proof: the sections of /dashboard. Mint has its own
 * active state on its link (below), so Keys is lit only for the keys routes — never for /mint.
 * The bottom tabs are the first four of these (the rest are reached from More on phones). The developer pages
 * are not in this list on purpose: they are linked from the foot of the sidebar (components/app/AppShell.tsx).
 */
export const APP_NAV: AppNavGroup[] = [
  {
    title: "Workspace",
    items: [
      { id: "overview", label: "Overview", href: sectionHref("overview"), icon: "home", section: "overview", match: ["/dashboard"] },
      { id: "swap", label: "Swap", href: sectionHref("swap"), icon: "swap", section: "swap", match: ["/swap"] },
      { id: "vault", label: "Vault", href: sectionHref("vault"), icon: "vault", section: "vault", match: ["/vault", "/pnl"] },
      { id: "keys", label: "Keys", href: sectionHref("keys"), icon: "key", section: "keys", match: ["/keys", "/gallery", "/key"] },
      { id: "pledge", label: "Pledge", href: sectionHref("pledge"), icon: "pledge", section: "pledge", match: ["/pledge"] },
      { id: "activity", label: "Activity", href: sectionHref("activity"), icon: "activity", section: "activity", match: ["/settle"] },
      { id: "proof", label: "My proof", href: sectionHref("proof"), icon: "shield", section: "proof", match: [] },
    ],
  },
];

const TAB_IDS = ["overview", "swap", "vault", "keys"] as const;

/** Whether a nav item is the current page. Pure, so the active state is unit-tested. */
export function isItemActive(item: AppNavItem, pathname: string | null | undefined, hash: string): boolean {
  if (!pathname) return false;
  // On /dashboard the hash picks the section; on an old route the route does.
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) return navSectionOf(parseSectionHash(hash).section) === item.section;
  return item.match.some((m) => pathname === m || pathname.startsWith(m + "/"));
}

/** Whether the "Mint a key" sidebar link is the current page. Pure, so the active state is unit-tested.
 * It is separate from isItemActive because Mint has its own link: Keys no longer matches /mint, so on /mint
 * no APP_NAV item is active and this link lights instead. */
export function isMintActive(pathname: string | null | undefined, hash: string): boolean {
  return pathname === "/mint" || pathname?.startsWith("/mint/") === true || (pathname === "/dashboard" && parseSectionHash(hash).section === "mint");
}

/** The title shown in the top bar for a route. Pure. */
const TITLES: [string, string][] = [
  ["/dashboard", "Overview"], ["/swap", "Swap"], ["/settle", "Activity"], ["/vault", "Vault"], ["/pnl", "Swap log"],
  ["/keys", "Keys"], ["/gallery", "Keys"], ["/key", "Key"], ["/mint", "Mint"], ["/pledge", "Pledge"],
];
export function pageTitle(path: string | null | undefined, hash = ""): string {
  if (!path) return "KEYHOLE";
  if (path === "/dashboard") return SECTION_LABEL[navSectionOf(parseSectionHash(hash).section)];
  const hit = TITLES.find(([p]) => path === p || path.startsWith(p + "/"));
  return hit ? hit[1] : "KEYHOLE";
}

const ICON: Record<AppIcon, ReactNode> = {
  home: <path d="M3.5 10.5 12 3.5l8.5 7V20a.5.5 0 0 1-.5.5h-5v-6h-6v6H4a.5.5 0 0 1-.5-.5z" />,
  key: <><circle cx="8" cy="12" r="3.6" /><path d="M11.6 12H21M18 12v3.2M21 12v2.4" /></>,
  swap: <path d="M7 4v15.5M7 19.5 3.5 16M7 19.5 10.5 16M17 20V4.5M17 4.5 13.5 8M17 4.5 20.5 8" />,
  vault: <><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><circle cx="12" cy="12" r="3" /></>,
  activity: <path d="M3 12.5h4l2.6-6.5 4.2 13 2.6-6.5H21" />,
  shield: <><path d="M12 3.5 19 6v5.5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></>,
  alert: <><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4.5M12 17.2v.1" /></>,
  pledge: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M9.5 12h5" /></>,
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
              // "Mint a key" has its own active state (the Keys item no longer matches /mint).
              const mintOn = isMintActive(pathname, hash);
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
                      <Link href={sectionHref("mint")} className={`app-link app-link-cta${mintOn ? " on" : ""}`} aria-current={mintOn ? "page" : undefined} data-testid="app-nav-mint" onClick={() => onNavigate?.(sectionHref("mint"))}>
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
  return <KeyStoreProvider><VaultDataProvider><AppShellFrame>{children}</AppShellFrame></VaultDataProvider></KeyStoreProvider>;
}

function AppShellFrame({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const { accountId } = useWallet();
  // Mint is a stable sidebar link for every signed-in account: the /mint page itself blocks an account that
  // already holds a key ("This account already holds a key. One key per account."), so the link is always shown
  // and the page decides. (It used to appear only when the key store had read this account and found no key,
  // so a holder never saw it — the tour found it missing.)
  const mint = !!accountId;
  const hash = useHash();
  const [open, setOpen] = useState(false);
  const network = networkPillLabel(PLEDGE_SANDBOX);
  const networkDetail = networkPillDetail(PLEDGE_SANDBOX);

  // The hash comes from useHash (lib/useHash.ts): it follows client links, back and forward, so the open section is always current.
  useEffect(() => { setOpen(false); }, [pathname, hash]);
  const vaultOpen = pathname === "/vault" || (pathname === "/dashboard" && parseSectionHash(hash).section === "vault");
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
        <p className="app-title" data-testid="app-title">{pageTitle(pathname, hash)}</p>
        <div className="app-top-end">
          <span className="app-net" data-testid="network-pill" title={networkDetail}><i aria-hidden="true" />{network}</span>
          <SessionPill />
          <AccountControl />
        </div>
      </header>
      <div className="app-body">
        <aside id="app-side" className={`app-side${open ? " open" : ""}`} aria-label="App">
          <AppNav pathname={pathname} hash={hash} mint={mint} onNavigate={() => setOpen(false)} />
          <div className="app-foot">
            <p className="app-net-line" title={networkDetail}><i aria-hidden="true" />{network}</p>
            <Link href="/" className="app-back" data-testid="app-back">← Back to site</Link>
            <Link href="/developers" className="app-proof" data-testid="app-developers">Developers and verification</Link>
            <p className="app-legal">
              <a href="https://near.org" target="_blank" rel="noreferrer">Built on NEAR</a>
              <span aria-hidden="true"> · </span>
              <TxLink account={KEYS_CONTRACT}>{KEYS_CONTRACT}</TxLink>
            </p>
          </div>
        </aside>
        <main id="main" className="app-main" tabIndex={-1}>{children}{vaultOpen && <PayoutPanel />}</main>
      </div>
      <AppTabs pathname={pathname} hash={hash} moreOpen={open} onMore={() => setOpen((v) => !v)} />
    </div>
  );
}
