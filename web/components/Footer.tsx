"use client";
import Link from "next/link";
import { KeyholeLogo } from "./KeyholeLogo";
import { KEYS_CONTRACT } from "@/lib/config";
import { TxLink } from "@/components/TxLink";
import { MusicToggle } from "./MusicToggle";

/**
 * Site footer, on public pages only (the app has its own legal line in components/app/AppShell.tsx).
 * Three groups as the plan sets them: Product, Proof, Learn. Then the contract on NEAR mainnet and the NEAR credit.
 */
export const FOOTER_GROUPS = [
  { title: "Product", links: [["/dashboard", "Launch app"], ["/mint", "Mint"], ["/swap", "Swap"], ["/vault", "Vault"]] },
  { title: "Proof", links: [["/verify", "Verify"], ["/attack", "Attack"], ["/judge", "Judge path"], ["/atlas", "Atlas"], ["/source", "Source"]] },
  { title: "Learn", links: [["/ask", "Ask"], ["/identity", "Identity"], ["/demo", "Demo"]] },
] as const;

export function Footer() {
  return (
    <footer className="ft" data-dark>
      <div className="ft-grid">
        <div className="ft-brand">
          <Link href="/" className="brand" aria-label="KEYHOLE home"><KeyholeLogo className="h-9" tone="light" /></Link>
          <p>Hold the key, run the account. Sell it, and the account goes with it.</p>
        </div>
        {FOOTER_GROUPS.map((g) => (
          <nav className="ft-col" key={g.title} aria-label={g.title}>
            <p className="ft-h">{g.title}</p>
            <ul>{g.links.map(([href, label]) => <li key={href}><Link href={href}>{label}</Link></li>)}</ul>
          </nav>
        ))}
      </div>
      <div className="ft-bar">
        <span className="mono">Contract {KEYS_CONTRACT} · NEAR mainnet</span>
        <span className="ft-tools">
          <MusicToggle />
          <TxLink account={KEYS_CONTRACT}>{KEYS_CONTRACT}</TxLink>
          <a href="https://near.org" target="_blank" rel="noreferrer" className="built">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/near.svg" width={16} height={16} alt="" />Built on NEAR
          </a>
        </span>
      </div>
    </footer>
  );
}
