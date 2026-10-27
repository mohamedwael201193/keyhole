import { nftTier, nftTokens } from "@/lib/near";
import { GalleryView } from "./view";
export const revalidate = 20;
export const metadata = { title: "Keys · KEYHOLE" };
export default async function Gallery() {
  const tokens = await nftTokens().catch(() => []);
  const tiers = await Promise.all(tokens.map((t) => nftTier(t.token_id).catch(() => null)));
  return <GalleryView tokens={tokens} tiers={tiers} />;
}
