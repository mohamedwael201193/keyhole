"use client";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { KeyholeLogo } from "./KeyholeLogo";
import { KEYS_CONTRACT, acct } from "@/lib/config";

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="ft" data-dark>
      <Link href="/" className="brand"><KeyholeLogo className="h-9" tone="light" /></Link>
      <span className="mono">{KEYS_CONTRACT} · NEAR mainnet · Intel TDX via OutLayer</span>
      <span style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <Link href="/atlas">{t("nav.atlas")}</Link>
        <Link href="/identity">{t("nav.identity")}</Link>
        <a href={acct(KEYS_CONTRACT)} target="_blank" rel="noreferrer">{KEYS_CONTRACT}</a>
        <a href="https://near.org" target="_blank" rel="noreferrer" className="built" aria-label={t("footer.built")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/near.svg" width={16} height={16} alt="" />{t("footer.built")}
        </a>
      </span>
    </footer>
  );
}
