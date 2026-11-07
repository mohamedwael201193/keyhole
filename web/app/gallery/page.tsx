import { nftTier, nftTokens } from "@/lib/near";
import { GalleryView } from "./view";
// Rendered per request (chain reads are cached 60 s in lib/rpc.ts), so `next build` never waits on the network.
export const dynamic = "force-dynamic";
export const metadata = { title: "Keys · KEYHOLE" };
/** `?mine=1` shows the connected account's keys instead (read in the view, from nft_tokens_for_owner). */
export default async function Gallery({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const mine = (await searchParams).mine === "1";
  if (mine) return <GalleryView tokens={[]} tiers={[]} mine />;
  const tokens = await nftTokens().catch(() => []);
  const tiers = await Promise.all(tokens.map((t) => nftTier(t.token_id).catch(() => null)));
  return <GalleryView tokens={tokens} tiers={tiers} mine={false} />;
}
