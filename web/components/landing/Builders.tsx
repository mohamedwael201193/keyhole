"use client";
/** For builders: two read-only code chips (the CLI command in cli/README and the MCP tool in cli/src/mcp.ts), the build hash and the repo links. */
import { useI18n } from "@/lib/i18n";
import type { publicOrderCensus } from "@/lib/settlements";

const REPO = "https://github.com/mohamedwael201193/keyhole";
const CLI = "cd cli && npx tsx src/cli.ts pledge status k5f4750858f328940";

export function Builders({ hash, orders }: { hash: string; orders: ReturnType<typeof publicOrderCensus> }) {
  const { t } = useI18n();
  return (
    <section className="lp-sec lp-builders" id="builders" aria-labelledby="builders-h">
      <div className="lp-wrap">
        <div className="lp-builders-in">
          <div className="lp-builders-grid">
            <div className="lp-builders-copy">
              <p className="lp-eyebrow">{t("landing2.v2.builders.eyebrow")}</p>
              <h2 id="builders-h" className="lp-h2 lp-h2--sm">{t("landing2.v2.builders.h2")}</h2>
            </div>
            <div className="lp-chips">
              <figure className="lp-chipcode">
                <figcaption>{t("landing2.v2.builders.cli")}</figcaption>
                <code>{CLI}</code>
              </figure>
              <figure className="lp-chipcode">
                <figcaption>{t("landing2.v2.builders.mcp")}</figcaption>
                <code>pledge_status</code>
              </figure>
            </div>
          </div>
          <p className="lp-links">
            <a href={REPO} target="_blank" rel="noopener noreferrer" className="lp-textlink">GitHub ↗</a>
            <a href={`${REPO}/blob/main/SECURITY.md`} target="_blank" rel="noopener noreferrer" className="lp-textlink">SECURITY.md ↗</a>
            <a href={`${REPO}/blob/main/VERIFY.md`} target="_blank" rel="noopener noreferrer" className="lp-textlink">VERIFY.md ↗</a>
            <span className="lp-hashline">{orders.label} <b data-testid="orders-stat" title={orders.detail}>{orders.total}</b> <em>{t("landing2.v2.builders.recordTag")}</em></span>
            <span className="lp-hashline">{t("landing2.v2.builders.build")} <a href="/verify/path" className="mono" data-testid="hash-stat">{hash}</a> <em>{t("landing2.v2.builders.buildTag")}</em></span>
          </p>
        </div>
      </div>
    </section>
  );
}
