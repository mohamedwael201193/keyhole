"use client";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { KEYS_CONTRACT, TEE_MINTER, WORKER_WASM_SHA256, acct, tx, WORKER_PUBLISH_TX } from "@/lib/config";
import { TXS } from "@/lib/evidence";
import type { Config } from "@/lib/near";
import { shortAccount } from "@/lib/near";

export function HowAndProof({ supply, config }: { supply: number | null; config: Config | null }) {
  const { t, fmtNum } = useI18n();
  const steps = [["01", "s1"], ["02", "s2"], ["03", "s3"]];
  return (
    <>
      <section className="relative z-10 mx-auto max-w-7xl px-4 py-20" aria-labelledby="how-h">
        <h2 id="how-h" className="font-serif text-4xl sm:text-5xl">{t("how.title")}</h2>
        <p className="mt-3 text-mute">{t("how.gasfree")}</p>
        <ol className="mt-10 grid gap-4 md:grid-cols-3">
          {steps.map(([n, k]) => (
            <li key={k} className="plate group p-6 transition hover:border-signal/60">
              <span className="font-mono text-xs text-signal">{n}</span>
              <h3 className="mt-3 font-serif text-3xl">{t(`how.${k}`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-300">{t(`how.${k}d`)}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-wrap gap-3"><Link className="btn btn-signal" href="/mint">{t("mint.title")}</Link><Link className="btn btn-ghost" href="/gallery">{t("nav.gallery")}</Link></div>
      </section>
      <section className="relative z-10 mx-auto max-w-7xl px-4 pb-24" aria-labelledby="proof-h">
        <h2 id="proof-h" className="font-serif text-4xl sm:text-5xl">{t("proof.title")}</h2>
        <p className="mt-3 text-mute">{t("proof.sub")}</p>
        <dl className="mt-8 grid gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          <Stat k={t("proof.contract")} v={<a className="text-signal underline-offset-4 hover:underline" href={acct(KEYS_CONTRACT)} target="_blank" rel="noreferrer">{KEYS_CONTRACT}</a>} />
          <Stat k={t("proof.minter")} v={<a className="text-signal underline-offset-4 hover:underline" href={acct(config?.minter || TEE_MINTER)} target="_blank" rel="noreferrer">{shortAccount(config?.minter || TEE_MINTER)}</a>} />
          <Stat k={t("proof.wasm")} v={<a className="break-all text-signal underline-offset-4 hover:underline" href={tx(WORKER_PUBLISH_TX)} target="_blank" rel="noreferrer">{WORKER_WASM_SHA256[0].slice(0, 16)}…</a>} />
          <Stat k={t("proof.supply")} v={supply == null ? "—" : fmtNum(supply)} />
          <Stat k={t("proof.beats")} v={config ? fmtNum(Number(config.beats)) : "—"} />
          <Stat k={t("proof.royalty")} v={config ? `${config.royalty_bps / 100}%` : "—"} />
        </dl>
        <ul className="mt-8 divide-y divide-line rounded border border-line">
          {TXS.map((x) => (
            <li key={x.hash} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="text-sm">{x.label}</span>
              <a className="font-mono text-xs text-signal hover:underline" href={tx(x.hash)} target="_blank" rel="noreferrer">{x.hash.slice(0, 10)}… ↗</a>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
function Stat({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="bg-plate p-5"><dt className="label">{k}</dt><dd className="mt-2 font-mono text-sm">{v}</dd></div>;
}
