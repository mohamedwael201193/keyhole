"use client";
import { PageHead } from "@/components/PageHead";
import { useI18n } from "@/lib/i18n";
import { ATLAS, CALLS } from "@/lib/evidence";
import { attestation, tx } from "@/lib/config";

export default function Atlas() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-7xl px-4 py-16">
      <PageHead eyebrow="Mainnet only" title={t("atlas.title")} sub={t("atlas.sub")} />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ATLAS.map((a) => (
          <li key={a.chain} className={`plate flex flex-col gap-3 p-5 ${a.kind !== "none" ? "border-signal/50" : ""}`} data-kind={a.kind}>
            <div className="flex items-center gap-3">
              <span className={`grid h-11 w-11 place-items-center rounded-full ${a.chain === "base" || a.chain === "eth" ? "bg-white" : "bg-black ring-1 ring-white/15"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/logos/${a.chain}.svg`} alt="" width={24} height={24} />
              </span>
              <span className="font-serif text-2xl">{a.name}</span>
              <span className={`ms-auto rounded px-2 py-0.5 font-mono text-[10px] ${a.kind !== "none" ? "bg-signal/15 text-signal" : "bg-zinc-800 text-zinc-400"}`}>{a.kind !== "none" ? t("atlas.real") : t("atlas.planned")}</span>
            </div>
            <p className="text-sm text-zinc-300">{a.kind === "none" ? t("atlas.planned_d") : a.note}</p>
            {a.kind === "tx" && <a className="font-mono text-xs text-signal hover:underline" href={tx(a.ref!)} target="_blank" rel="noreferrer">{t("atlas.open")} ↗</a>}
            {a.kind === "call" && <a className="font-mono text-xs text-signal hover:underline" href={attestation(a.ref!)} target="_blank" rel="noreferrer">{t("atlas.att")} ↗</a>}
          </li>
        ))}
      </ul>
      <h2 className="mt-16 font-serif text-4xl">{t("verify.examples")}</h2>
      <ul className="mt-6 divide-y divide-line rounded border border-line">
        {CALLS.map((c) => (
          <li key={c.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-6">
            <span className="text-sm">{c.label}</span>
            <span className={`font-mono text-xs ${c.outcome.startsWith("refused") ? "text-amber-300" : "text-signal"}`}>{c.outcome}</span>
            <a className="font-mono text-xs text-signal hover:underline" href={`/verify?call=${c.id}`}>{c.id.slice(0, 8)} · verify →</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
