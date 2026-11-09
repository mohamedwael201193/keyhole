import type { Metadata, Viewport } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Cormorant_Garamond, DM_Mono, Inter } from "next/font/google";
import "./tokens.css";
import "./globals.css";
import "./ui.css";
import "./landing.css";
import "./app-shell.css";
import "./app-pages.css";
import "../components/v7/v7.css";
import "./overview.css";
import { Providers } from "./providers";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SiteFrame } from "@/components/SiteFrame";

/** Official modal stylesheet, minus the Google Fonts @import (blocked by style-src). */
const walletModalCss = readFileSync(join(process.cwd(), "node_modules/@near-wallet-selector/modal-ui/styles.css"), "utf8")
  .replace(/@import\s+url\([^)]*\)\s*;?/g, "");

/* Display serif (headings, card titles, big figures), UI sans (Inter) and mono (hashes, ids, serials). Roles: app/tokens.css. */
const serif = Cormorant_Garamond({ subsets: ["latin"], weight: ["500", "600", "700"], style: ["normal", "italic"], variable: "--font-cormorant", display: "swap" });
const sans = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter", display: "swap" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-dm", display: "swap" });
export const metadata: Metadata = {
  title: "KEYHOLE — the NFT is the viewing key",
  description: "An NFT that is the viewing key to a confidential trading account inside an attested TEE on NEAR. Hold the key, run the account. Sell it, and the account goes with it.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://keyhole-seven.vercel.app"),
  openGraph: { title: "KEYHOLE", description: "Nothing on the chain. Everything in the key.", images: [{ url: "/og.png", width: 1200, height: 630 }] },
  icons: { icon: [{ url: "/brand/favicon.svg", type: "image/svg+xml" }, { url: "/favicon.ico" }], apple: "/apple-icon.png" },
};
export const viewport: Viewport = { themeColor: "#E6DFD0", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <style id="nws-modal-styles" dangerouslySetInnerHTML={{ __html: walletModalCss }} />
        <Providers>
          <SiteFrame nav={<Nav />} footer={<Footer />}>{children}</SiteFrame>
        </Providers>
      </body>
    </html>
  );
}
