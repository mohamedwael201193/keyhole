"use client";
import Link from "next/link";
import { Cipher } from "./Cipher";
import { KeyArt } from "./Art";
import { Guilloche, Hallmark } from "./Engraving";
import { FoilCard } from "./FoilCard";
import { useI18n } from "@/lib/i18n";
import { keyState, shortAccount, shortKeyId, type Token } from "@/lib/near";
import { formatTradePrice } from "@/lib/price";
import { CAPS, keyIdentity, serialOf } from "@/lib/traits";

export function traitLabel(t: (k: string) => string, name: string) {
  const v = t(`traits.${name}`);
  return v.startsWith("traits.") ? name : v;
}

/** Live key card. The visible number is mint order; the token id is printed under the title and links to the key's history. */
export function KeyCard({ token, tier, viewer, displayIndex }: { token: Token; tier: number | null; viewer: string | null; displayIndex: number }) {
  const { t } = useI18n();
  const id = keyIdentity(token.token_id, tier);
  const state = keyState(token, tier, viewer);
  const yours = !!viewer && viewer === token.owner_id;
  /** Same name as the vault and mint pages: short token id. Mint order is shown beside it. */
  const title = t("gallery.key", { id: shortKeyId(token.token_id) });
  return (
    <article className="gk" data-state={state} data-testid="key-nft">
      <FoilCard finish={id.finish}>
        <div className="top">
          <span className="tier">{t(`finish.${id.finish}`)}</span>
          <span className="oo" data-testid="mint-no">No. {displayIndex} · {t("land.oneOfOne")}</span>
        </div>
        <div className="art">
          <Guilloche seed={id.seedHex} />
          <KeyArt n={id.art} alt={title} width={430} height={1080} />
        </div>
        <Hallmark bits={id.bits} serial={serialOf(id.seedHex)} />
        <h3 title={token.token_id}><Link href={`/key?id=${encodeURIComponent(token.token_id)}`} data-testid="key-link">{title}</Link></h3>
        <div className="meta">
          <span>{t("field.cipher")}</span>
          <span>{formatTradePrice(CAPS[id.finish].perTx)}</span>
        </div>
      </FoilCard>
      <p className="tid mono" data-testid="key-tid">{t("gallery.tokenId", { id: token.token_id })}</p>
      <p className="att">{t("land.attested")}</p>
      <dl>
        <dt>{t("field.head")}</dt><dd>{traitLabel(t, id.head)}</dd>
        <dt>{t("field.filigree")}</dt><dd>{traitLabel(t, id.filigree)}</dd>
        <dt>{t("field.enamel")}</dt><dd>{traitLabel(t, id.enamel)}</dd>
        <dt>{t("field.gem")}</dt><dd>{traitLabel(t, id.gem)}</dd>
        <dt>{t("field.shaft")}</dt><dd>{traitLabel(t, id.shaft)}</dd>
      </dl>
      <div className="cbar"><span>{t("field.cipher")}</span><Cipher bits={id.bits} width={112} height={22} /><span className="bits">{id.bits}</span></div>
      <p className={`owner${yours ? " yours" : ""}`}>{yours ? t("gallery.yours") : shortAccount(token.owner_id)}</p>
      <p className="hist"><Link href={`/key?id=${encodeURIComponent(token.token_id)}`}>{t("gallery.history")} →</Link></p>
    </article>
  );
}
