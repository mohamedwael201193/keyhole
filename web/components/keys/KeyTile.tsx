"use client";
import Link from "next/link";
import { KeyArt } from "@/components/Art";
import { Guilloche, Hallmark } from "@/components/Engraving";
import { FoilCard } from "@/components/FoilCard";
import { useI18n } from "@/lib/i18n";
import { keyState, shortAccount, shortKeyId, type Token } from "@/lib/near";
import { nearText } from "@/lib/sale";
import { CAPS, keyIdentity, serialOf } from "@/lib/traits";
import { formatTradePrice } from "@/lib/price";
import { StatusChip } from "@/components/v7";
import type { SaleRead } from "./keyData";

/**
 * One key in the gallery grid. Restores the animated foil face (FoilCard + guilloche + hallmark)
 * from the pre-v7 KeyCard, inside the v7 tile layout. The whole foil is a button that selects the
 * key for the details panel; the name is a link to the key's history and proof page.
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
        <FoilCard finish={id.finish} className="kg-foil">
          <div className="top">
            {tier === null
              ? <span className="tier" data-testid="tier-unread">Tier not read</span>
              : <span className="tier">{t(`finish.${id.finish}`)}</span>}
            <span className="oo" data-testid="mint-no">No. {index} · {t("land.oneOfOne")}</span>
          </div>
          <div className="art">
            <Guilloche seed={id.seedHex} />
            <KeyArt n={id.art} alt="" width={430} height={1080} />
          </div>
          <Hallmark bits={id.bits} serial={serialOf(id.seedHex)} />
        </FoilCard>
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
