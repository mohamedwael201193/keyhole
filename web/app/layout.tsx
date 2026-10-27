import type { Metadata, Viewport } from "next";
import { Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument", display: "swap", preload: false });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-jb", display: "optional", preload: false });

export const metadata: Metadata = {
  title: "KEYHOLE — the NFT is the viewing key",
  description: "An NFT that is the viewing key to a confidential trading account inside an attested TEE on NEAR. Hold the key, read the book. Sell it, and the view moves.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://keyhole.vercel.app"),
  openGraph: { title: "KEYHOLE", description: "Nothing on the chain. Everything in the key.", images: [{ url: "/og.png", width: 1200, height: 630 }] },
  icons: { icon: [{ url: "/brand/favicon.svg", type: "image/svg+xml" }, { url: "/favicon.ico" }], apple: "/apple-icon.png" },
};
export const viewport: Viewport = { themeColor: "#050706", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={`${serif.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        <Providers>
          <Nav />
          <main id="main">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
