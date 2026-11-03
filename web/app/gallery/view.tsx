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
      <details className="traitsx" data-testid="traits-explain">
        <summary>What the marks on a key mean</summary>
        <dl>
          <dt>Serial (6 hex characters, e.g. 020842)</dt><dd>The first six characters of the key&apos;s seed, sha256 of the contract id plus the token id. It is unique per key and is engraved on the hallmark.</dd>
          <dt>Bit cipher (8 bars, e.g. 10110010)</dt><dd>The last byte of the token id as eight bits, drawn as bars. A quick visual fingerprint; it carries no secret.</dd>
          <dt>Head, filigree, enamel, gem, shaft</dt><dd>Art traits picked from the same seed, so anyone can recompute them from the token id. They are decoration; they do not change what the key can do.</dd>
          <dt>Finish and the $ figure</dt><dd>The key&apos;s tier and its per-trade cap inside the enclave.</dd>
        </dl>
      </details>
      {tokens.length === 0 ? <p className="note">{t("gallery.empty")}</p> : (
        <div className="gg" data-testid="gallery">
          {tokens.map((tk, i) => <KeyCard key={tk.token_id} token={tk} tier={tiers[i]} viewer={accountId} displayIndex={i + 1} />)}
        </div>
      )}
      <p className="note" style={{ marginTop: 28 }}><Link href="/identity" style={{ color: "var(--teal)" }}>{t("gallery.toIdentity")}</Link></p>
    </div>
  );
}
