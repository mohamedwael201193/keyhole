"use client";
import dynamic from "next/dynamic";
import { useEffect } from "react";
import { DashboardView } from "@/app/dashboard/view";
import { useHash } from "@/lib/useHash";
import { parseSectionHash, navSectionOf } from "@/lib/dashboardSections";
import { Skeleton } from "@/components/v7";

const loading = () => <Skeleton lines={4} testid="section-loading" />;
// Sections other than the overview load on first use, so the dashboard opens with only the overview's code.
const SwapView = dynamic(() => import("@/app/swap/view").then((m) => m.SwapView), { loading });
const VaultView = dynamic(() => import("@/app/vault/view").then((m) => m.VaultView), { loading });
const GalleryView = dynamic(() => import("@/app/gallery/view").then((m) => m.GalleryView), { loading });
const MintView = dynamic(() => import("@/app/mint/view").then((m) => m.MintView), { loading });
const PledgeView = dynamic(() => import("@/app/pledge/view").then((m) => m.PledgeView), { loading });
const SettleView = dynamic(() => import("@/app/settle/view").then((m) => m.SettleView), { loading });
const MyProof = dynamic(() => import("./MyProof").then((m) => m.MyProof), { loading });

/**
 * The personal dashboard: one page, one section at a time, chosen by the URL hash (/dashboard#swap). The sidebar and the phone
 * tabs in components/app/AppShell.tsx do the navigating; this draws the section. Only the open section is mounted, so the
 * enclave reads of one section never run beside another's. Every section is an existing view, unchanged in behaviour.
 * A click on a link to another section (for example "Open swap" inside Vault) is a hash change here, not a page load.
 */
export function Workspace() {
  const hash = useHash();
  const { section, arg } = parseSectionHash(hash);

  // A new section opens at the top, like a new page.
  useEffect(() => { if (hash) window.scrollTo?.({ top: 0 }); }, [section, hash]);

  return (
    <div className="ws" data-testid="workspace" data-section={section} data-nav={navSectionOf(section)}>
      {section === "overview" && <DashboardView />}
      {section === "swap" && <SwapView />}
      {section === "vault" && <VaultView initialOnline={false} />}
      {section === "keys" && <GalleryView initial="mine" />}
      {section === "mint" && <MintView initialOnline={false} />}
      {section === "pledge" && <PledgeView />}
      {section === "activity" && <SettleView />}
      {section === "proof" && <MyProof callId={arg} />}
    </div>
  );
}
