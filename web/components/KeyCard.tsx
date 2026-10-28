"use client";
import { Cipher } from "./Cipher";
import { KeyArt } from "./Art";
import { FoilCard } from "./FoilCard";
import { useI18n } from "@/lib/i18n";
import { KEYS_CONTRACT } from "@/lib/config";
import { keyState, type Token } from "@/lib/near";
import { FINISH_COLOR, keyIdentity } from "@/lib/traits";

export function traitLabel(t: (k: string) => string, name: string) {
  const v = t(`traits.${name}`);
  return v.startsWith("traits.") ? name : v;
}

/** Keep a long token id on one line: #k5f47…8940. Short ids stay whole. */
export function shortTokenId(id: string) {
  if (id.length <= 12) return id;
  return `${id.slice(0, 5)}…${id.slice(-4)}`;
}

/** Live key card. Art and traits come from sha256(contract + token id); state comes from the chain. */
export function KeyCard({ token, tier, viewer }: { token: Token; tier: number | null; viewer: string | null }) {
  const { t } = useI18n();
  const id = keyIdentity(token.token_id, tier);
  const state = keyState(token, tier, viewer);
  return (
    <FoilCard as="article" finish={id.finish} className="card gk" data-state={state} data-testid="key-nft">
      <div className="top">
        <span className="tier" style={{ background: FINISH_COLOR[id.finish] }}>{t(`finish.${id.finish}`)}</span>
        <span className="mono" style={{ fontSize: 12, color: "#3E4A4B" }}>{t("land.oneOfOne")}</span>
      </div>
      <KeyArt n={id.art} className="k" alt={t("land.keyN", { n: token.token_id })} width={430} height={1080} />
      <h3 title={t("gallery.key", { id: token.token_id })}>
        {t("gallery.key", { id: token.token_id }).replace(/#.*$/, "").trim()}
        <span className="tid">#{shortTokenId(token.token_id)}</span>
      </h3>
      <dl>
        <dt>{t("field.head")}</dt><dd>{traitLabel(t, id.head)}</dd>
        <dt>{t("field.filigree")}</dt><dd>{traitLabel(t, id.filigree)}</dd>
        <dt>{t("field.enamel")}</dt><dd>{traitLabel(t, id.enamel)}</dd>
        <dt>{t("field.gem")}</dt><dd>{traitLabel(t, id.gem)}</dd>
        <dt>{t("field.shaft")}</dt><dd>{traitLabel(t, id.shaft)}</dd>
      </dl>
      <div className="cbar"><span>{t("field.cipher")}</span><Cipher bits={id.bits} /></div>
      <p className="mono" style={{ fontSize: 11, color: "#3E4A4B", marginTop: 8 }}>{KEYS_CONTRACT}</p>
    </FoilCard>
  );
}
