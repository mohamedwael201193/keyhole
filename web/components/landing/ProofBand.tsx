"use client";
/**
 * Supported tokens and live on mainnet: one dark emerald band, two halves. Left, six real token marks (TokenMark, the same marks the
 * swap uses) and "+N more", where N is the live 1Click token count minus the six shown; when that read failed the count is hidden.
 * Right, the live mainnet numbers (LiveStats). Nothing here is a fixed number.
 */
import { useI18n } from "@/lib/i18n";
import type { TokenReach } from "@/lib/landing";
import { TokenMark } from "@/components/TokenMark";
import { LiveStats } from "./LiveStats";
import { Icon } from "./icons";

const SHOWN = [
  { symbol: "NEAR", chain: null },
  { symbol: "USDC", chain: null },
  { symbol: "USDT", chain: null },
  { symbol: "BTC", chain: null },
  { symbol: "ETH", chain: null },
  { symbol: "SOL", chain: null },
] as const;

export function ProofBand({ supply, reach }: { supply: number | null; reach: TokenReach | null }) {
  const { t } = useI18n();
  const more = reach && reach.tokens > SHOWN.length ? reach.tokens - SHOWN.length : null;
  return (
    <section className="lp-sec lp-proof" id="proof" aria-label={t("landing2.v2.tokens.eyebrow")}>
      <div className="lp-wrap">
        <div className="lp-band lp-proof-band">
          <div className="lp-tokens">
            <p className="lp-eyebrow lp-eyebrow--light">{t("landing2.v2.tokens.eyebrow")}</p>
            <ul className="lp-tok-row">
              {SHOWN.map((s) => (
                <li key={s.symbol} className="lp-tok">
                  <span className="lp-tok-chip"><TokenMark symbol={s.symbol} size={40} /></span>
                  <span className="lp-tok-sym">{s.symbol}</span>
                </li>
              ))}
              {more != null && (
                <li className="lp-tok lp-tok--more" data-testid="reach-more">
                  <span className="lp-tok-chip lp-tok-chip--n" aria-hidden="true"><Icon name="layers" size={22} /></span>
                  <span className="lp-tok-sym" data-testid="reach-tokens">{t("landing2.v2.tokens.more", { n: more })}</span>
                </li>
              )}
            </ul>
          </div>
          <LiveStats supply={supply} />
        </div>
      </div>
    </section>
  );
}
