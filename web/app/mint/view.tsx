"use client";
import Link from "next/link";
import { PageHead } from "@/components/PageHead";
import { Attested, ErrorBox } from "@/components/Result";
import { KeyNFT } from "@/components/KeyNFT";
import { useI18n } from "@/lib/i18n";
import { useWallet } from "@/lib/wallet";
import { useSigned } from "@/lib/useSigned";
import { tx } from "@/lib/config";
import { Backdrop } from "@/components/Backdrop";
import { HowStrip } from "@/components/HowStrip";
import { EmptyState } from "@/components/EmptyState";
import { OfflineState } from "@/components/Result";
import { useHealth } from "@/lib/useHealth";

// Tier limits as enforced by the worker (tee/worker limits_for_tier). Tier 3 is reserved.
const TIERS = [{ k: "tier1", perTx: 1, daily: 5, perMin: 6 }, { k: "tier2", perTx: 10, daily: 50, perMin: 12, soon: true }, { k: "tier3", perTx: 100, daily: 500, perMin: 30, reserved: true }];

export function MintView({ initialOnline }: { initialOnline: boolean }) {
  const { t, fmtUsd } = useI18n();
  const { accountId, connect } = useWallet();
  const m = useSigned("mint");
  const online = useHealth(initialOnline);
  const o = m.res?.output;
  return (
    <div className="relative isolate"><Backdrop /><div className="relative z-10 mx-auto max-w-5xl px-4 py-16">
      <PageHead eyebrow={t("how.gasfree")} title={t("mint.title")} sub={t("mint.sub")} />
      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-6">
          <section className="plate overflow-x-auto p-6" aria-labelledby="tiers-h">
            <h2 id="tiers-h" className="label mb-4">{t("mint.limits")}</h2>
            <table className="w-full min-w-[420px] text-start font-mono text-sm">
              <thead><tr className="text-mute"><th className="py-2 text-start font-normal">{t("vault.tier")}</th><th className="text-start font-normal">{t("vault.perTx")}</th><th className="text-start font-normal">{t("vault.daily")}</th><th className="text-start font-normal">{t("vault.perMin")}</th></tr></thead>
              <tbody>{TIERS.map((x) => (
                <tr key={x.k} className="border-t border-line"><td className="py-3">{t(`mint.${x.k}`)} {x.reserved && <span className="ms-1 text-amber-300">· {t("mint.reserved")}</span>}</td>
                  <td>{fmtUsd(x.perTx * 1e6)}</td><td>{fmtUsd(x.daily * 1e6)}</td><td>{x.perMin}</td></tr>))}</tbody>
            </table>
            <p className="mt-3 text-xs text-mute">{t("mint.one")}</p>
          </section>
          {online === false && <OfflineState />}
          {online !== false && !accountId && (
            <EmptyState title={t("empty.mintTitle")} body={t("empty.mintBody")} testid="mint-empty">
              <button className="btn btn-signal" onClick={connect}>{t("nav.connect")}</button>
            </EmptyState>
          )}
          <HowStrip active={accountId ? 2 : 1} />
          {online !== false && accountId && <section className="plate p-6">
            {<button className="btn btn-signal" disabled={m.busy} onClick={() => void m.run({})} data-testid="mint-btn">{m.busy ? "…" : t("mint.sign")}</button>}
            {o?.ok && (<div className="mt-5" data-testid="minted"><p className="font-serif text-2xl text-signal">{t("mint.done")}</p>
              <p className="mt-1 font-mono text-sm">token {o.token_id}</p>
              {typeof o.tx === "string" && <a className="btn btn-ghost mt-3" href={tx(o.tx)} target="_blank" rel="noreferrer">{t("mint.view")} ↗</a>}
              <Link className="btn btn-signal ms-2 mt-3" href="/vault">{t("hero.cta")}</Link></div>)}
            {m.res?.error && <div className="mt-4"><ErrorBox code={m.res.error.code} retryAfter={m.res.error.retry_after} /></div>}
            {m.res && <Attested r={m.res} />}
          </section>}
        </div>
        <KeyNFT forceState={o?.ok ? "unlocked" : "locked"} />
      </div>
    </div></div>
  );
}
