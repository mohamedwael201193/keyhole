"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell, isAppRoute } from "./app/AppShell";

/**
 * Picks the chrome for the route. App routes get the app shell and no site footer (the shell has its legal line). Every other
 * route gets the public top bar, <main id="main">, and the site footer. Both branches render <main id="main">, so the skip link works everywhere.
 */
export function SiteFrame({ nav, footer, children }: { nav: ReactNode; footer: ReactNode; children: ReactNode }) {
  const path = usePathname();
  if (isAppRoute(path)) return <AppShell>{children}</AppShell>;
  return (
    <>
      {nav}
      <main id="main">{children}</main>
      {footer}
    </>
  );
}
