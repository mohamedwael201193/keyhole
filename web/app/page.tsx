import type { Metadata } from "next";
import { Landing } from "@/components/Landing";
import { loadLanding, loadTokenReach } from "@/lib/landing";
import { fetchLiveRegistry } from "@/lib/liveRegistry";

/** The home page title and description (the other routes keep the layout's). The description is one sentence of the hero copy. */
export const metadata: Metadata = {
  title: "KEYHOLE · Sell a trading account like an NFT",
  description: "Your key is an NFT on NEAR, and behind it sits a private trading account inside a sealed enclave.",
};

/** Served from cache and rebuilt at most once a minute (ISR). The chain reads in loadLanding are short, shared and never throw. */
export const revalidate = 60;

export default async function Home() {
  const [{ supply }, reach, live] = await Promise.all([loadLanding(), loadTokenReach(), fetchLiveRegistry().catch(() => null)]);
  // Live OutLayer registry active_version (revalidated with the page); "unavailable" when it cannot be read, never the repo pin.
  return <Landing supply={supply} hash={live ? live.active_version.slice(0, 8) : "unavailable"} reach={reach} />;
}
