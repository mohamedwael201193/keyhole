import { nftTier, nftTokens } from "@/lib/near";
import { GalleryView, type KeysFilter } from "./view";
// Rendered per request (chain reads are cached 60 s in lib/rpc.ts), so `next build` never waits on the network.
export const dynamic = "force-dynamic";
export const metadata = { title: "Keys · KEYHOLE" };
/** `?mine=1` opens My keys and `?sale=1` opens For sale. Plain /gallery reads the first page of every key here, on the server. */
export default async function Gallery({ searchParams }: { searchParams: Promise<{ mine?: string; sale?: string }> }) {
  const q = await searchParams;
  const initial: KeysFilter = q.mine === "1" ? "mine" : q.sale === "1" ? "sale" : "all";
  if (initial !== "all") return <GalleryView initial={initial} />;
  const tokens = await nftTokens().catch(() => []);
  const tiers = await Promise.all(tokens.map((t) => nftTier(t.token_id).catch(() => null)));
  return <GalleryView initial="all" serverTokens={tokens} serverTiers={tiers} />;
}
