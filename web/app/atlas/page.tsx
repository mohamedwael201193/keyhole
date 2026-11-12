"use client";
import { Purpose, Badge } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { ATLAS, CALLS } from "@/lib/evidence";
import { attestation } from "@/lib/config";
import { TxLink } from "@/components/TxLink";
import { TokenIcon } from "@/components/TokenIcon";
import { explorerLabelKey } from "@/lib/atlasLabels";
import "../public-pages.css";

type Tone = "ok" | "info" | "wait";

/** A chain gets a mark only when it has a record: a mainnet tx, an attested dry run or a settled order. Planned chains show no mark. */
export default function Atlas() {
  const { t } = useI18n();
  const KIND: Record<"tx" | "call" | "settle" | "none", { tone: Tone; label: string }> = {
    tx: { tone: "ok", label: t("atlas.real") },
    settle: { tone: "ok", label: t("atlas.settled") },
    call: { tone: "info", label: t("atlas.dry") },
    none: { tone: "wait", label: t("atlas.planned") },
  };
  return (
    <div className="page pp pp-atlas">
      <Purpose eyebrow={t("atlas.eyebrow")} title={t("atlas.title")} line={t("atlas.sub")} />
      <ul className="pp-marks" data-testid="atlas">
        {ATLAS.map((a) => {
          const k = KIND[a.kind];
          return (
            <li key={a.chain} className={`pp-mark pp-mark--${a.kind}`} data-kind={a.kind}>
              <div className="pp-mark-head">
                {a.kind !== "none" && <TokenIcon symbol={a.name} chain={a.chain} size={32} />}
                <div className="pp-mark-name">
                  <h2>{a.name}</h2>
                  <Badge tone={k.tone}>{k.label}</Badge>
                </div>
              </div>
              <p className="pp-mark-note">{a.kind === "none" ? t("atlas.planned_d") : a.note}</p>
              {(a.kind === "tx" || a.kind === "call" || (a.kind === "settle" && a.href)) && (
                <div className="pp-mark-act">
                  {a.kind === "tx" && <TxLink hash={a.ref!}>{t("atlas.open")} ↗</TxLink>}
                  {a.kind === "call" && <a className="ulink" href={attestation(a.ref!)} target="_blank" rel="noreferrer">{t("atlas.att")} ↗</a>}
                  {a.kind === "settle" && a.href && <a className="ulink" href={a.href} target="_blank" rel="noreferrer">{t(explorerLabelKey(a.chain))} ↗</a>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <section className="pp-card" aria-labelledby="atlas-calls">
        <h2 id="atlas-calls">{t("verify.examples")}</h2>
        <ul className="pp-calls">
          {CALLS.map((c) => (
            <li key={c.id}>
              <span className="pp-call-what">{c.label}<small>{c.outcome}</small></span>
              <a className="ulink" href={`/verify?call=${c.id}`} aria-label={`Verify call ${c.id.slice(0, 8)}: ${c.label}`}>Verify {c.id.slice(0, 8)}</a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
