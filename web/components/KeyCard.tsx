"use client";
import { Cipher } from "./Cipher";
import { KeyArt } from "./Art";
import { Engraving } from "./Engraving";
import { FoilCard } from "./FoilCard";
import { useI18n } from "@/lib/i18n";
import { keyState, shortAccount, type Token } from "@/lib/near";
import { formatTradePrice } from "@/lib/price";
import { CAPS, foilHue, keyIdentity, serialOf } from "@/lib/traits";

export function traitLabel(t: (k: string) => string, name: string) {
  const v = t(`traits.${name}`);
  return v.startsWith("traits.") ? name : v;
}

/** Live key card. The visible number is mint order. The token id stays on the title. */
export function KeyCard({ token, tier, viewer, displayIndex }: { token: Token; tier: number | null; viewer: string | null; displayIndex: number }) {
  const { t } = useI18n();
  const id = keyIdentity(token.token_id, tier);
  const state = keyState(token, tier, viewer);
  const yours = !!viewer && viewer === token.owner_id;
  const title = t("gallery.key", { id: String(displayIndex) });
  return (
    <article className="gk" data-state={state} data-testid="key-nft">
      <FoilCard finish={id.finish} hue={foilHue(id.seedHex)}>
        <div className="top">
          <span className="tier">{t(`finish.${id.finish}`)}</span>
          <span className="oo">{t("land.oneOfOne")}</span>
        </div>
        <div className="art">
          <KeyArt n={id.art} alt={title} width={430} height={1080} />
          <Engraving bits={id.bits} serial={serialOf(id.seedHex)} />
        </div>
        <h3 title={token.token_id}>{title}</h3>
        <div className="meta">
          <span>{t("field.cipher")}</span>
          <span>{formatTradePrice(CAPS[id.finish].perTx)}</span>
        </div>
      </FoilCard>
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
    </article>
  );
}
