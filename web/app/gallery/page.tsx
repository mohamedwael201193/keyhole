import { nftTier, nftTokens } from "@/lib/near";
import { GalleryView } from "./view";
// Rendered per request (chain reads are cached 60 s in lib/rpc.ts), so `next build` never waits on the network.
export const dynamic = "force-dynamic";
export const metadata = { title: "Keys · KEYHOLE" };
export default async function Gallery() {
  const tokens = await nftTokens().catch(() => []);
  const tiers = await Promise.all(tokens.map((t) => nftTier(t.token_id).catch(() => null)));
  return <GalleryView tokens={tokens} tiers={tiers} />;
}
