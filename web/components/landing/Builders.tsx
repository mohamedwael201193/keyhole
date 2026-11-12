"use client";
/** For builders: two read-only code cards (the CLI command in cli/README and the MCP tool in cli/src/mcp.ts) and the repo links. */
import { useI18n } from "@/lib/i18n";

const REPO = "https://github.com/mohamedwael201193/keyhole";
const CLI = "cd cli && npx tsx src/cli.ts pledge status k5f4750858f328940";

export function Builders() {
  const { t } = useI18n();
  return (
    <section className="lp-sec lp-builders" id="builders" aria-labelledby="builders-h">
      <div className="lp-wrap">
        <p className="lp-eyebrow">{t("landing2.builders.eyebrow")}</p>
        <h2 id="builders-h" className="lp-h2">{t("landing2.builders.h2")}</h2>
        <div className="lp-code-grid">
          <figure className="lp-codecard">
            <p className="lp-code-label">{t("landing2.builders.cliLabel")}</p>
            <pre><code>{CLI}</code></pre>
          </figure>
          <figure className="lp-codecard">
            <p className="lp-code-label">{t("landing2.builders.mcpLabel")}</p>
            <pre><code>pledge_status</code></pre>
          </figure>
        </div>
        <p className="lp-cta lp-cta--tight">
          <a href={REPO} target="_blank" rel="noopener noreferrer" className="lp-link">{t("landing2.builders.github")} ↗</a>
          <a href={`${REPO}/blob/main/SECURITY.md`} target="_blank" rel="noopener noreferrer" className="lp-link">{t("landing2.builders.security")} ↗</a>
          <a href={`${REPO}/blob/main/VERIFY.md`} target="_blank" rel="noopener noreferrer" className="lp-link">{t("landing2.builders.verifyDoc")} ↗</a>
        </p>
      </div>
    </section>
  );
}
