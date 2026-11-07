"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell, isAppRoute } from "./app/AppShell";

/**
 * Picks the chrome for the route: the app shell for the holder routes (components/app/AppShell.tsx), otherwise the public
 * top bar and footer. Both branches render <main id="main">, so the skip link works on every page.
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
