"use client";
/**
 * "Proof you can check": the numbers are real. The checks count is the browser checks on /verify (TOTAL_CHECKS); the two hashes
 * come from the build identity (lib/config.ts); the order count is the evidence file (lib/settlements.ts).
 */
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/motion";
import { useI18n } from "@/lib/i18n";
import { SETTLEMENTS } from "@/lib/settlements";

export function ProofStrip({ checks, workerHash, workerFull, contractHash, contractFull }: {
  checks: number; workerHash: string; workerFull: string; contractHash: string; contractFull: string;
}) {
  const { t } = useI18n();
  return (
    <div className="pf">
      <dl className="pf-stats">
        <div>
          <dt>{t("home.stChecks")}</dt>
          <dd><Link href="/verify" className="pf-link" data-testid="checks-stat"><CountUp value={checks} /></Link></dd>
        </div>
        <div>
          <dt>{t("home.stHash")}</dt>
          <dd><Link href="/judge" className="pf-link mono" data-testid="hash-stat" title={workerFull}>{workerHash}</Link></dd>
        </div>
        <div>
          <dt>{t("home.stContract")}</dt>
          <dd><Link href="/verify" className="pf-link mono" title={contractFull}>{contractHash}</Link></dd>
        </div>
        <div>
          <dt>{t("home.stOrders")}</dt>
          <dd data-testid="orders-stat">{SETTLEMENTS.length}</dd>
        </div>
      </dl>
      <div className="pf-actions">
        <Button href="/verify" testid="verify-cta">{t("home.verifyBtn")}</Button>
        <Button href="/judge" variant="secondary" testid="judge-cta">{t("land.judgeCta")}</Button>
      </div>
    </div>
  );
}
