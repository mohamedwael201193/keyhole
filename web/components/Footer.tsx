"use client";
import { useI18n } from "@/lib/i18n";
import { KeyholeLogo } from "./KeyholeLogo";
import { KEYS_CONTRACT, acct } from "@/lib/config";

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="relative z-10 border-t border-line">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-8 text-sm text-mute">
        <KeyholeLogo size={22} />
        <a href={acct(KEYS_CONTRACT)} target="_blank" rel="noreferrer" className="font-mono text-xs hover:text-white">{KEYS_CONTRACT}</a>
        <span className="text-xs">{t("footer.license")}</span>
        <a href="https://near.org" target="_blank" rel="noreferrer" className="ms-auto inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-3 text-[12px] font-medium text-black" aria-label={t("footer.built")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/near.svg" width="16" height="16" alt="" />{t("footer.built")}
        </a>
      </div>
    </footer>
  );
}
