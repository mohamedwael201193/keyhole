"use client";
import { KeyNFT } from "@/components/KeyNFT";
import { PageHead } from "@/components/PageHead";
import { useI18n } from "@/lib/i18n";
import { useWallet } from "@/lib/wallet";
import type { Token } from "@/lib/near";

export function GalleryView({ tokens, tiers }: { tokens: Token[]; tiers: (number | null)[] }) {
  const { t } = useI18n();
  const { accountId } = useWallet();
  return (
    <div className="mx-auto max-w-7xl px-4 py-16">
      <PageHead eyebrow="NEP-171 · keyhole-devmo.near" title={t("gallery.title")} sub={t("gallery.sub")} />
      {tokens.length === 0 ? <p className="text-mute">{t("gallery.empty")}</p> : (
        <><h2 className="sr-only">{t("nav.gallery")}</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="gallery">
          {tokens.map((tk, i) => <KeyNFT key={tk.token_id} token={tk} tier={tiers[i]} viewer={accountId} index={i} total={tokens.length} />)}
        </div></>
      )}
      <h2 className="mt-20 font-serif text-4xl">{t("gallery.states")}</h2>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(["locked", "unlocked", "expired", "legendary"] as const).map((s, i) => <KeyNFT key={s} forceState={s} index={i} total={4} />)}
      </div>
    </div>
  );
}
