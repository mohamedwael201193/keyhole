"use client";
import Link from "next/link";
import { KeyArt } from "@/components/Art";
import { useI18n } from "@/lib/i18n";
import { keyState, nearText, shortAccount, shortKeyId, type Token } from "@/lib/near";
import { CAPS, keyIdentity } from "@/lib/traits";
import { formatTradePrice } from "@/lib/price";
import { StatusChip, TierChip } from "@/components/v7";
import type { SaleRead } from "./keyData";

/**
 * One key in the gallery grid. The whole art area is a button that selects the key for the details panel; the name is a
 * link to the key's history and proof page. Tier, cap and the holder or sale state come from the chain reads the page passes in.
 */
export function KeyTile({ token, tier, index, viewer, sale, selected, onSelect }: {
  token: Token;
  /** nft_tier of this key, or null when it could not be read. */
  tier: number | null;
  /** 1-based position in the list. */
  index: number;
  viewer: string | null;
  sale: SaleRead;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const id = keyIdentity(token.token_id, tier);
  const state = keyState(token, tier, viewer);
  const yours = !!viewer && viewer === token.owner_id;
  const title = t("gallery.key", { id: shortKeyId(token.token_id) });
  const listed = sale !== null && typeof sale === "object";
  return (
    <article className={`kg-tile${selected ? " is-selected" : ""}`} data-state={state} data-tier={id.finish.toLowerCase()} data-testid="key-nft">
      <button type="button" className="kg-tile-pick" aria-pressed={selected} aria-label={`Show details for ${title}`} onClick={onSelect}>
        <span className="kg-tile-top">
          {tier === null ? <TierChip tier="Tier not read" /> : <TierChip tier={id.finish} />}
          <span className="kg-tile-no" data-testid="mint-no">No. {index} · {t("land.oneOfOne")}</span>
        </span>
        <span className="kg-tile-art">
          <KeyArt n={id.art} alt="" width={430} height={1080} />
        </span>
      </button>
      <div className="kg-tile-foot">
        <Link href={`/key?id=${encodeURIComponent(token.token_id)}`} className="kg-tile-name" data-testid="key-link" title={token.token_id}>{title}</Link>
        <p className="kg-tile-tid" data-testid="key-tid">{t("gallery.tokenId", { id: token.token_id })}</p>
        <div className="kg-tile-meta">
          <span className="kg-tile-cap">{tier === null ? "Cap not read" : formatTradePrice(CAPS[id.finish].perTx)}</span>
          {yours ? <StatusChip tone="success">You own it</StatusChip>
            : listed ? <StatusChip tone="info">For sale · {nearText(sale.price)} NEAR</StatusChip>
            : <StatusChip tone="neutral" icon="none">Held by {shortAccount(token.owner_id)}</StatusChip>}
        </div>
      </div>
    </article>
  );
}

/** A placeholder tile while the tier or the token is still being read. */
export function KeyTileSkeleton() {
  return (
    <div className="kg-tile kg-tile--skel" aria-hidden="true">
      <span className="kg-skel-art" />
      <span className="kg-skel-line" />
      <span className="kg-skel-line short" />
    </div>
  );
}
