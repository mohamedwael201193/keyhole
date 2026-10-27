"use client";
import { useI18n } from "@/lib/i18n";
/** The 3-step strip. Numbers stay 01/02/03. */
export function HowStrip({ active }: { active?: 1 | 2 | 3 }) {
  const { t } = useI18n();
  return (
    <ol className="howstrip" aria-label={t("how.title")}>
      {[1, 2, 3].map((n) => (
        <li key={n} className={active === n ? "on" : ""}>
          <span data-testid="step-num">{String(n).padStart(2, "0")}</span>
          <p>{t(`how.s${n}`)}</p>
          <small>{t(`how.s${n}d`)}</small>
        </li>
      ))}
    </ol>
  );
}
