import type { Metadata } from "next";
import { Landing } from "@/components/Landing";
import { loadLanding, loadTokenReach } from "@/lib/landing";
import { fetchLiveRegistry } from "@/lib/liveRegistry";

/** The home page title, description and social image (1200x630). The other routes keep the layout's. */
export const metadata: Metadata = {
  title: "KEYHOLE · Sell a trading account like an NFT",
  description: "An NFT that is the key to a private trading account. Hold the key and you run the account. Sell the key and the account goes with it.",
  openGraph: {
    title: "KEYHOLE · Sell a trading account like an NFT",
    description: "An NFT that is the key to a private trading account on NEAR.",
    images: [{ url: "/landing/og-image.webp", width: 1200, height: 630 }],
  },
};

/** Served from cache and rebuilt at most once a minute (ISR). The chain reads in loadLanding are short, shared and never throw. */
export const revalidate = 60;

export default async function Home() {
  const [{ supply }, reach, live] = await Promise.all([loadLanding(), loadTokenReach(), fetchLiveRegistry().catch(() => null)]);
  // Live OutLayer registry active_version (revalidated with the page); "unavailable" when it cannot be read, never the repo pin.
  return <Landing supply={supply} hash={live ? live.active_version.slice(0, 8) : "unavailable"} reach={reach} />;
}
