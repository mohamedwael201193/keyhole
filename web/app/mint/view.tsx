"use client";
import Link from "next/link";
import { Attested, ErrorBox, OfflineState } from "@/components/Result";
import { HowStrip } from "@/components/HowStrip";
import { EmptyState } from "@/components/EmptyState";
import { Cipher } from "@/components/Cipher";
import { KeyArt } from "@/components/Art";
import { Engraving } from "@/components/Engraving";
import { FoilCard } from "@/components/FoilCard";
import { useI18n } from "@/lib/i18n";
import { useWallet } from "@/lib/wallet";
import { useSigned } from "@/lib/useSigned";
import { useHealth } from "@/lib/useHealth";
import { tx } from "@/lib/config";
import { formatTradePrice } from "@/lib/price";
import { CAPS, foilHue, keyIdentity, serialOf } from "@/lib/traits";
import { traitLabel } from "@/components/KeyCard";

const SHOWN = [
  { k: "Bronze", art: 3 },
  { k: "Silver", art: 4 },
  { k: "Gold", art: 2 },
  { k: "Legendary", art: 1 },
] as const;

export function MintView({ initialOnline }: { initialOnline: boolean }) {
  const { t, fmtUsd } = useI18n();
  const { accountId, connect } = useWallet();
  const m = useSigned("mint");
  const online = useHealth(initialOnline);
  const o = m.res?.output;
  const revealed = !!(o?.ok && o.token_id);
  const idn = revealed ? keyIdentity(String(o.token_id), 1) : null;
  const step = revealed ? 3 : accountId ? 2 : 1;
  return (
    <div className="page">
      <div className="mint">
        <FoilCard finish={idn?.finish ?? "Bronze"} hue={idn ? foilHue(idn.seedHex) : 0}>
          <div className="top">
            <span className="tier">{t(`finish.${idn?.finish ?? "Bronze"}`)}</span>
            <span className="oo">{t("land.oneOfOne")}</span>
          </div>
          <div className="art">
            <KeyArt n={idn?.art ?? 3} alt={revealed ? t("gallery.key", { id: String(o.token_id) }) : t("finish.Bronze")} width={406} height={1084} priority />
            {idn && <Engraving bits={idn.bits} serial={serialOf(idn.seedHex)} />}
          </div>
          <h3>{revealed ? t("gallery.key", { id: String(o.token_id) }) : t("mint.preview")}</h3>
          <div className="meta"><span className={revealed ? undefined : "wrap"}>{revealed ? t("mint.tag", { id: String(o.token_id), finish: t(`finish.${idn!.finish}`) }) : t("mint.bronzeOnly")}</span></div>
        </FoilCard>
        <div>
          <p className="eb">{t("mint.step", { n: step })}</p>
          <div className="steps">
            <span className={step === 1 ? "on" : ""}>{t("mint.s1")}</span>
            <span className={step === 2 ? "on" : ""}>{t("mint.s2")}</span>
            <span className={step === 3 ? "on" : ""}>{t("mint.s3")}</span>
          </div>
          {revealed && idn ? (
            <>
              <h1>{t("mint.revealedA")}<em>{t("mint.revealedB")}</em></h1>
              <p className="lead" style={{ marginTop: 18 }}>{t("mint.forged")}</p>
              <dl className="tt">
                {(["head", "filigree", "enamel", "gem", "shaft"] as const).map((k) => (
                  <div key={k}><dt>{t(`field.${k}`)}</dt><dd>{traitLabel(t, idn[k])}</dd></div>
                ))}
                <div><dt>{t("field.cipher")}</dt><dd><Cipher bits={idn.bits} /></dd></div>
              </dl>
              <div className="hero-actions">
                <Link className="btn b1" href="/vault">{t("mint.openVault")}</Link>
                {typeof o.tx === "string" && <a className="btn b2" href={tx(o.tx)} target="_blank" rel="noreferrer">{t("mint.view")}</a>}
              </div>
              <p className="mono" style={{ fontSize: 13, color: "var(--mu)", marginTop: 18 }} data-testid="minted">
                {t("mint.capsLine", { finish: t(`finish.${idn.finish}`), tx: fmtUsd(idn.perTx * 1e6), day: fmtUsd(idn.daily * 1e6) })}
              </p>
              {m.res && <Attested r={m.res} />}
            </>
          ) : (
            <>
              <h1>{t("mint.title")}</h1>
              <p className="lead" style={{ marginTop: 18 }}>{t("mint.sub")}</p>
              <div className="tg" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 22 }}>
                {SHOWN.map((x) => (
                  <div className={`tc${x.k === "Bronze" ? " is-mint" : ""}`} key={x.k}>
                    <FoilCard finish={x.k}>
                      <div className="top">
                        <span className="tier">{t(`finish.${x.k}`)}</span>
                        <span className="oo">{t("land.oneOfOne")}</span>
                      </div>
                      <div className="art"><KeyArt n={x.art} alt={t(`finish.${x.k}`)} width={430} height={1080} /></div>
                      <h3>{t(`finish.${x.k}`)}</h3>
                      <div className="meta"><span>{formatTradePrice(CAPS[x.k].perTx)}</span></div>
                    </FoilCard>
                    {x.k === "Bronze" ? null : (
                      <p className="finish-lock">
                        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                        {t("mint.finishPreview")}
                      </p>
                    )}
                    <p className="below">{x.k === "Legendary" ? t("land.legDaily") : t("mint.perMin", { n: CAPS[x.k].perMin })}</p>
                  </div>
                ))}
              </div>
              <p className="note">{t("mint.bronzeOnly")}</p>
              {online === false && <OfflineState />}
              {online !== false && !accountId && (
                <EmptyState title={t("empty.mintTitle")} body={t("empty.mintBody")} testid="mint-empty">
                  <button className="btn b1" onClick={connect}>{t("nav.connect")}</button>
                </EmptyState>
              )}
              {online !== false && accountId && (
                <div style={{ marginTop: 18 }}>
                  <button className="btn b1" disabled={m.busy} onClick={() => void m.run({})} data-testid="mint-btn">{m.busy ? "…" : t("mint.sign")}</button>
                  {m.res?.error && <ErrorBox code={m.res.error.code} retryAfter={m.res.error.retry_after} />}
                  {m.res && <Attested r={m.res} />}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <HowStrip active={accountId ? 2 : 1} />
    </div>
  );
}
