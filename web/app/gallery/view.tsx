"use client";
import Link from "next/link";
import { KeyCard } from "@/components/KeyCard";
import { useI18n } from "@/lib/i18n";
import { useWallet } from "@/lib/wallet";
import type { Token } from "@/lib/near";

export function GalleryView({ tokens, tiers }: { tokens: Token[]; tiers: (number | null)[] }) {
  const { t } = useI18n();
  const { accountId } = useWallet();
  return (
    <div className="page">
      <p className="eb">{t("gallery.eyebrow")}</p>
      <h1>{t("gallery.h1a")}<em>{t("gallery.h1b")}</em></h1>
      <p className="lead">{t("gallery.lead")}</p>
      {tokens.length === 0 ? <p className="note">{t("gallery.empty")}</p> : (
        <div className="gg" data-testid="gallery">
          {tokens.map((tk, i) => <KeyCard key={tk.token_id} token={tk} tier={tiers[i]} viewer={accountId} displayIndex={i + 1} />)}
        </div>
      )}
      <p className="note" style={{ marginTop: 28 }}><Link href="/identity" style={{ color: "var(--teal)" }}>{t("gallery.toIdentity")}</Link></p>
    </div>
  );
}
