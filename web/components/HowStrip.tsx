"use client";
import { useI18n } from "@/lib/i18n";
/** The 3-step "how it works" strip used on empty states. */
export function HowStrip({ active }: { active?: 1 | 2 | 3 }) {
  const { t } = useI18n();
  return (
    <ol className="grid gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-3" aria-label={t("how.title")}>
      {[1, 2, 3].map((n) => (
        <li key={n} className={`relative bg-plate p-5 ${active === n ? "shadow-[inset_0_2px_0_#00ec97]" : ""}`}>
          <span data-testid="step-num" className={`font-mono text-sm tracking-widest ${active === n ? "text-signal" : "text-zinc-300"}`}>{String(n).padStart(2, "0")}</span>
          <p className="mt-2 font-serif text-2xl">{t(`how.s${n}`)}</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">{t(`how.s${n}d`)}</p>
        </li>
      ))}
    </ol>
  );
}
