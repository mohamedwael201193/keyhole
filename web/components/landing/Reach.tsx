"use client";
/**
 * "Trade anything, from anywhere": the 1Click token count and chain count, read on the server when the page renders
 * (lib/landing.ts loadTokenReach, bounded to 3 s). When that read fails the sentence has no number. The marks are the real
 * icons the site ships (components/TokenIcon.tsx), one per icon, each labelled with the token it came from.
 */
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TokenIcon } from "@/components/TokenIcon";
import { chainName } from "@/lib/tokens";
import { useI18n } from "@/lib/i18n";
import type { TokenReach } from "@/lib/landing";

export function Reach({ reach }: { reach: TokenReach | null }) {
  const { t } = useI18n();
  const lead = reach ? t("lp.tradeLead", { n: reach.tokens, m: reach.chains }) : t("lp.tradeLeadNoCount");
  return (
    <div className="reach" data-testid="reach">
      <p className="lp-lead">{lead}</p>
      {reach && reach.marks.length > 0 && (
        <ul className="reach-row" aria-label={t("lp.tradeH")}>
          {reach.marks.map((tok) => (
            <li key={tok.assetId} className="reach-chip">
              <TokenIcon assetId={tok.assetId} symbol={tok.symbol} chain={tok.blockchain} size={32} />
              <span><b>{tok.symbol}</b><small>{chainName(tok.blockchain)}</small></span>
            </li>
          ))}
        </ul>
      )}
      <p className="lp-note">{t("lp.tradeNote")}</p>
      <div className="lp-cta">
        <Button href="/swap" variant="secondary" testid="swap-cta">{t("lp.openSwap")}</Button>
        <Link href="/settle" className="lp-link lp-cta-link">{t("home.ctaSettle")}</Link>
      </div>
    </div>
  );
}
