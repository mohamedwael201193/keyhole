"use client";
/**
 * "Proof, not promises": four live numbers, each a link to the place it can be checked. The key count is keys held by people
 * (lib/supply.ts holderSupply: minted minus the contract-held test key). When the server could not read it, SupplyStat polls /api/supply.
 * The order count is the public order census (lib/settlements.ts publicOrderCensus): one sealed vault swap plus each listed 1Click order.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export function SupplyStat({ initial }: { initial: number | null }) {
  const [n, setN] = useState(initial);
  useEffect(() => {
    if (initial != null) return;
    let cancel = false;
    const tick = () => fetch("/api/supply").then((r) => r.json()).then((j) => {
      if (!cancel && Number.isInteger(j?.supply)) setN(j.supply);
    }).catch(() => {});
    tick();
    const id = window.setInterval(tick, 3_000);
    const stop = window.setTimeout(() => window.clearInterval(id), 12_000);
    return () => { cancel = true; window.clearInterval(id); window.clearTimeout(stop); };
  }, [initial]);
  return <span data-testid="supply">{n == null ? "—" : n}</span>;
}

export function ProofStrip({ supply, checks, hash, orders }: {
  supply: number | null; checks: number; hash: string; orders: { total: number; label: string; detail: string };
}) {
  const { t } = useI18n();
  return (
    <div className="pf">
      <dl className="pf-stats">
        <div>
          <dt>{t("home.supplyLabel")}</dt>
          <dd><Link href="/keys" className="pf-link" data-testid="keys-stat"><SupplyStat initial={supply} /></Link></dd>
        </div>
        <div>
          <dt>{t("home.stHash")}</dt>
          <dd><Link href="/judge" className="pf-link mono" data-testid="hash-stat">{hash}</Link></dd>
        </div>
        <div>
          <dt>{t("home.stChecks")}</dt>
          <dd><Link href="/verify" className="pf-link" data-testid="checks-stat">{checks}</Link></dd>
        </div>
        <div>
          <dt>{orders.label}</dt>
          <dd><Link href="/settle" className="pf-link" data-testid="orders-stat" title={orders.detail}>{orders.total}</Link></dd>
        </div>
      </dl>
      <div className="pf-actions">
        <Button href="/verify" testid="verify-cta">{t("home.verifyBtn")}</Button>
        <Button href="/judge" variant="secondary" testid="judge-cta">{t("land.judgeCta")}</Button>
      </div>
    </div>
  );
}
