"use client";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { KeyholeLogo } from "./KeyholeLogo";
import { KEYS_CONTRACT } from "@/lib/config";
import { TxLink } from "@/components/TxLink";
import { MusicToggle } from "./MusicToggle";

/** The product: the holder's path, in the order a new user takes it. */
const PRODUCT = [
  ["/start", "start"],
  ["/mint", "mint"],
  ["/vault", "vault"],
  ["/settle", "trade"],
  ["/judge", "judge"],
  ["/verify", "verify"],
] as const;

/** Proof and reference pages: real routes, kept out of the top bar. */
const PROOF = [
  ["/gallery", "gallery"],
  ["/demo", "demo"],
  ["/ask", "ask"],
  ["/atlas", "atlas"],
  ["/identity", "identity"],
  ["/source", "source"],
] as const;

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="ft" data-dark>
      <div className="ft-grid">
        <div className="ft-brand">
          <Link href="/" className="brand"><KeyholeLogo className="h-9" tone="light" /></Link>
          <p>{t("footer.tagline")}</p>
        </div>
        <nav className="ft-col" aria-label={t("footer.product")}>
          <p className="ft-h">{t("footer.product")}</p>
          <ul>{PRODUCT.map(([href, key]) => <li key={key}><Link href={href}>{t(`footer.${key}`)}</Link></li>)}</ul>
        </nav>
        <nav className="ft-col" aria-label={t("footer.proof")}>
          <p className="ft-h">{t("footer.proof")}</p>
          <ul>{PROOF.map(([href, key]) => <li key={key}><Link href={href}>{t(`footer.${key}`)}</Link></li>)}</ul>
        </nav>
      </div>
      <div className="ft-bar">
        <span className="mono">{KEYS_CONTRACT} · NEAR mainnet · Intel TDX via OutLayer</span>
        <span className="ft-tools">
          <MusicToggle />
          <TxLink account={KEYS_CONTRACT}>{KEYS_CONTRACT}</TxLink>
          <a href="https://near.org" target="_blank" rel="noreferrer" className="built" aria-label={t("footer.built")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/near.svg" width={16} height={16} alt="" />{t("footer.built")}
          </a>
        </span>
      </div>
    </footer>
  );
}
