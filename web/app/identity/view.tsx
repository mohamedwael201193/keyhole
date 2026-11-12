"use client";
import { Cipher } from "@/components/Cipher";
import { Icon, KeyArt } from "@/components/Art";
import { KeyholeLogo } from "@/components/KeyholeLogo";
import { traitLabel } from "@/components/KeyCard";
import { Guilloche, Hallmark } from "@/components/Engraving";
import { FoilCard } from "@/components/FoilCard";
import { useI18n } from "@/lib/i18n";
import { KEYS_CONTRACT } from "@/lib/config";
import type { Token } from "@/lib/near";
import { formatTradePrice } from "@/lib/price";
import { CAPS, CATALOG, nep177, serialOf, traitSeed, toHex } from "@/lib/traits";
import "../public-pages.css";

/** Every design image that is not a minted key carries this label. Only Bronze is minted today (worker tier 1). */
const PREVIEW = "Preview, not minted";

const CARDS = [CATALOG[2], CATALOG[3], CATALOG[1], CATALOG[0]];

export function IdentityView({ tokens, tiers }: { tokens: Token[]; tiers: (number | null)[] }) {
  const { t } = useI18n();
  const live = tokens[0];
  const meta = live ? nep177(live.token_id, tiers[0]) : nep177("3", 1);
  const bits = (n: number) => n.toString(2).padStart(8, "0");
  return (
    <div className="page sheet pp pp-identity">
      <p className="eb">{t("ident.eyebrow")}</p>
      <h1>{t("ident.h1a")}<em>{t("ident.h1b")}</em></h1>

      <div className="blk">
        <p className="eb">{t("ident.s1")}</p>
        <h2>{t("ident.card")}</h2>
        <div className="cards">
          {CARDS.map((k) => {
            const seed = toHex(traitSeed(KEYS_CONTRACT, String(k.n)));
            return (
            <article className="specimen" key={k.n}>
              <FoilCard finish={k.finish}>
                <div className="top">
                  <span className="tier">{t(`finish.${k.finish}`)}</span>
                  <span className="oo">{t("land.oneOfOne")}</span>
                </div>
                <div className="art">
                  <Guilloche seed={seed} />
                  <KeyArt n={k.n} alt="" width={430} height={1080} />
                </div>
                <Hallmark bits={bits(k.n)} serial={serialOf(seed)} />
                <h3>{t("land.keyN", { n: k.n })}</h3>
                <div className="meta">
                  <span>{t("land.cipherN", { n: k.n })}</span>
                  <span>{formatTradePrice(CAPS[k.finish].perTx)}</span>
                </div>
              </FoilCard>
              {/* Only Bronze is minted today (worker main.rs tier 1). Other finishes are design previews, not attested keys. */}
              {k.finish === "Bronze" ? <p className="att" data-testid="mintable-badge">Design specimen · mintable today</p> : <p className="att" data-testid="preview-badge">Preview, not minted</p>}
              <p className="mono" style={{ fontSize: 13, color: "var(--mu)" }}>{KEYS_CONTRACT}</p>
              <dl>
                <dt>{t("field.head")}</dt><dd>{traitLabel(t, k.head)}</dd>
                <dt>{t("field.filigree")}</dt><dd>{traitLabel(t, k.filigree)}</dd>
                <dt>{t("field.enamel")}</dt><dd>{traitLabel(t, k.enamel)}</dd>
                <dt>{t("field.gem")}</dt><dd>{traitLabel(t, k.gem)}</dd>
                <dt>{t("field.shaft")}</dt><dd>{traitLabel(t, k.shaft)}</dd>
              </dl>
              <div className="ft2"><KeyholeLogo className="h-7" tone="ink" /><Cipher bits={bits(k.n)} /></div>
            </article>
            );
          })}
        </div>
      </div>

      <div className="blk">
        <p className="eb">{t("ident.s2")}</p>
        <h2>{t("ident.wild")}</h2>
        <p className="note">These are layout previews. Silver, Gold and Legendary are not minted; only Bronze is minted today.</p>
        <div className="thumbs">
          <div className="wal">
            <p className="h">{t("ident.wallet")} <span className="pp-preview" data-testid="preview-label">{PREVIEW}</span></p>
            <div className="tgrid">
              {CATALOG.slice(0, 6).map((k) => (
                <div className="tm" key={k.n}><div className="sq"><KeyArt n={k.n} alt="" width={200} height={480} /></div><p>{t("land.keyN", { n: k.n })}<small>{t(`finish.${k.finish}`)}</small></p><span className="pp-preview">{PREVIEW}</span></div>
              ))}
            </div>
          </div>
          <div className="wal">
            <p className="h">{t("ident.market")}</p>
            {CATALOG.slice(6).map((k) => (
              <div className="idrow" key={k.n}>
                <div className="sq"><KeyArt n={k.n} alt="" width={80} height={200} /></div>
                <div><b>{t("land.keyN", { n: k.n })}</b><small>{t(`finish.${k.finish}`)} · {traitLabel(t, k.head)}</small></div>
                <span className="pp-preview" data-testid="preview-label">{PREVIEW}</span>
              </div>
            ))}
          </div>
          <div className="wal">
            <p className="h">{t("ident.sizes")} <span className="pp-preview" data-testid="preview-label">{PREVIEW}</span></p>
            <div className="sizes">
              {[120, 72, 40].map((w) => <div className="sq" key={w} style={{ width: w, height: w }}><KeyArt n={1} alt="" width={120} height={280} /></div>)}
            </div>
            <p className="mono" style={{ fontSize: 13, color: "var(--mu)", marginTop: 14 }}>{t("ident.sizesD")}</p>
          </div>
        </div>
      </div>

      <div className="blk two">
        <div>
          <p className="eb">{t("ident.s3")}</p>
          <h2>{t("ident.schema")}</h2>
          <div className="code">{JSON.stringify(meta, null, 2)}</div>
          <p className="note">{live ? t("ident.live", { id: live.token_id }) : t("ident.sample")}</p>
        </div>
        <div>
          <p className="eb">{t("ident.s4")}</p>
          <h2>{t("ident.metals")}</h2>
          <div className="fin">
            {[
              ["Bronze", "linear-gradient(135deg,#C58A5E,#8A5A3C)", "#8A5A3C → #C58A5E"],
              ["Silver", "linear-gradient(135deg,#D5DCE0,#6E7A80)", "#6E7A80 → #D5DCE0"],
              ["Gold", "linear-gradient(135deg,#E3C06A,#9A7420)", "#9A7420 → #E3C06A"],
              ["Legendary", "linear-gradient(135deg,#F6D9A8,#7A1F4F)", "#7A1F4F → #F6D9A8"],
            ].map(([name, bg, hex]) => (
              <div className="fn" key={name}><div className="sw" style={{ background: bg }} /><div className="t"><b>{t(`finish.${name}`)}</b><p>{t(`ident.metal.${name}`)}</p><p className="mono" style={{ fontSize: 13 }}>{hex}</p></div></div>
            ))}
          </div>
        </div>
      </div>

      <div className="blk">
        <p className="eb">{t("ident.s5")}</p>
        <h2>{t("ident.brand")}</h2>
        <div className="brand3">
          <div className="bx">
            <p className="mono" style={{ fontSize: 13, color: "var(--mu)", marginBottom: 16 }}>LOGO</p>
            <KeyholeLogo className="h-16" tone="ink" />
            <div style={{ marginTop: 18, background: "#1F4B4F", borderRadius: 18, padding: 18, color: "#F6F1E7" }}><KeyholeLogo className="h-12" tone="light" /></div>
          </div>
          <div className="bx">
            <p className="mono" style={{ fontSize: 13, color: "var(--mu)", marginBottom: 16 }}>{t("ident.type")}</p>
            <p style={{ font: "700 42px/1 var(--serif)" }}>Cormorant Garamond</p>
            <p className="mono" style={{ fontSize: 13, color: "var(--mu)" }}>{t("ident.typeD")}</p>
            <p style={{ font: "600 22px var(--sans)", marginTop: 16 }}>Inter 400–600</p>
            <p style={{ font: "500 18px var(--mono)", marginTop: 16 }}>DM Mono 400/500</p>
          </div>
          <div className="bx">
            <p className="mono" style={{ fontSize: 13, color: "var(--mu)", marginBottom: 16 }}>{t("ident.palette")}</p>
            <div className="pal">
              {[["#ECE6DA", "#1A2A2C", "Ecru"], ["#F6F1E7", "#1A2A2C", "Ivory"], ["#1A2A2C", "#F6F1E7", "Ink"], ["#1F4B4F", "#F6F1E7", "Teal"], ["#A8432C", "#F6F1E7", "Coral"], ["#D9644A", "#1A2A2C", "Coral"], ["#7D5A1E", "#F6F1E7", "Brass"], ["#B8893E", "#1A2A2C", "Brass"]].map(([bg, fg, name]) => (
                <div key={bg + name} style={{ background: bg, color: fg }}>{name}<br />{bg}</div>
              ))}
            </div>
            <div className="icons">{[1, 2, 3, 4, 5, 6].map((n) => <Icon key={n} n={n} />)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
