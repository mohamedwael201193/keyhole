"use client";
import Link from "next/link";
import { Attested, ErrorBox, OfflineState } from "@/components/Result";
import { HowStrip } from "@/components/HowStrip";
import { EmptyState } from "@/components/EmptyState";
import { Cipher } from "@/components/Cipher";
import { KeyArt } from "@/components/Art";
import { FoilCard } from "@/components/FoilCard";
import { useI18n } from "@/lib/i18n";
import { useWallet } from "@/lib/wallet";
import { useSigned } from "@/lib/useSigned";
import { useHealth } from "@/lib/useHealth";
import { tx } from "@/lib/config";
import { CAPS, FINISH_COLOR, keyIdentity } from "@/lib/traits";
import { traitLabel } from "@/components/KeyCard";

const SHOWN = [
  { k: "Bronze", art: 3 },
  { k: "Silver", art: 4 },
  { k: "Gold", art: 2 },
  { k: "Legendary", art: 10 },
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
        <FoilCard finish={idn?.finish ?? "Bronze"} className="reveal">
          <div className="rays" />
          <KeyArt n={idn?.art ?? 3} className="k" alt={revealed ? t("gallery.key", { id: String(o.token_id) }) : t("finish.Bronze")} width={406} height={1084} priority />
          <span className="tag">{revealed ? t("mint.tag", { id: String(o.token_id), finish: t(`finish.${idn!.finish}`) }) : t("mint.preview")}</span>
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
                  <FoilCard key={x.k} finish={x.k} className="card mint-tier">
                    <span className="tier" style={{ background: FINISH_COLOR[x.k] }}>{t(`finish.${x.k}`)}</span>
                    <p style={{ marginTop: 10, fontFamily: "var(--serif)", fontSize: 28 }}>{fmtUsd(CAPS[x.k].perTx * 1e6)} <small style={{ color: "var(--mu)", fontSize: 14 }}>/ {fmtUsd(CAPS[x.k].daily * 1e6)}</small></p>
                    <p className="note">{x.k === "Legendary" ? t("land.legDaily") : t("mint.perMin", { n: CAPS[x.k].perMin })}</p>
                  </FoilCard>
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
