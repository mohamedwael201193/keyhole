"use client";
import { PageHead } from "@/components/PageHead";
import { Medal } from "@/components/Medal";
import { useI18n } from "@/lib/i18n";
import { ATLAS, CALLS } from "@/lib/evidence";
import { attestation, tx } from "@/lib/config";
import { TxLink } from "@/components/TxLink";

export default function Atlas() {
  const { t } = useI18n();
  return (
    <div className="page">
      <PageHead eyebrow={t("atlas.eyebrow")} title={t("atlas.title")} sub={t("atlas.sub")} />
      <ul className="atlas">
        {ATLAS.map((a) => (
          <li key={a.chain} className="card" data-kind={a.kind}>
            <div className="row" style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Medal id={a.chain} name="" labeled={false} />
              <span style={{ fontFamily: "var(--serif)", fontSize: 28 }}>{a.name}</span>
            </div>
            <p className="note">{a.kind === "none" ? t("atlas.planned_d") : a.note}</p>
            <p className="mono" style={{ fontSize: 12, color: a.kind === "none" ? "var(--mu)" : "var(--teal)" }}>{a.kind !== "none" ? t("atlas.real") : t("atlas.planned")}</p>
            {a.kind === "tx" && <span style={{ color: "var(--teal)" }}><TxLink hash={a.ref!}>{t("atlas.open")} ↗</TxLink></span>}
            {a.kind === "call" && <a style={{ color: "var(--teal)" }} href={attestation(a.ref!)} target="_blank" rel="noreferrer">{t("atlas.att")} ↗</a>}
          </li>
        ))}
      </ul>
      <h2 style={{ marginTop: 48 }}>{t("verify.examples")}</h2>
      <ul className="proof" style={{ padding: 0 }}>
        {CALLS.map((c) => (
          <li key={c.id}><span>{c.label} · {c.outcome}</span><a href={`/verify?call=${c.id}`}>{c.id.slice(0, 8)}</a></li>
        ))}
      </ul>
    </div>
  );
}
