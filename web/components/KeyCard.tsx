"use client";
import { Cipher } from "./Cipher";
import { KeyArt } from "./Art";
import { FoilCard } from "./FoilCard";
import { useI18n } from "@/lib/i18n";
import { KEYS_CONTRACT } from "@/lib/config";
import { keyState, type Token } from "@/lib/near";
import { formatTradePrice } from "@/lib/price";
import { CAPS, keyIdentity } from "@/lib/traits";

export function traitLabel(t: (k: string) => string, name: string) {
  const v = t(`traits.${name}`);
  return v.startsWith("traits.") ? name : v;
}

/** Keep a long token id on one line: #k5f47…8940. Short ids stay whole. */
export function shortTokenId(id: string) {
  if (id.length <= 12) return id;
  return `${id.slice(0, 5)}…${id.slice(-4)}`;
}

/** Live key card. The face matches sketch B. Traits sit under the card. */
export function KeyCard({ token, tier, viewer }: { token: Token; tier: number | null; viewer: string | null }) {
  const { t } = useI18n();
  const id = keyIdentity(token.token_id, tier);
  const state = keyState(token, tier, viewer);
  const full = t("gallery.key", { id: token.token_id });
  const title = `${full.replace(/#.*$/, "").trim()} #${shortTokenId(token.token_id)}`;
  return (
    <article className="gk" data-state={state} data-testid="key-nft">
      <FoilCard finish={id.finish}>
        <div className="top">
          <span className="tier">{t(`finish.${id.finish}`)}</span>
          <span className="oo">{t("land.oneOfOne")}</span>
        </div>
        <div className="art">
          <KeyArt n={id.art} alt={title} width={430} height={1080} />
        </div>
        <h3 className={token.token_id.length > 12 ? "long" : undefined} title={full}>{title}</h3>
        <div className="meta">
          <span>{t("land.cipherN", { n: shortTokenId(token.token_id) })}</span>
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
      <div className="cbar"><span>{t("field.cipher")}</span><Cipher bits={id.bits} /></div>
      <p className="mono" style={{ fontSize: 11, color: "#3E4A4B" }}>{KEYS_CONTRACT}</p>
    </article>
  );
}
