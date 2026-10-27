import { nftTier, nftTokens } from "@/lib/near";
import { IdentityView } from "./view";
export const revalidate = 30;
export const metadata = { title: "Identity · KEYHOLE" };
export default async function Page() {
  const tokens = await nftTokens().catch(() => []);
  const tiers = await Promise.all(tokens.map((t) => nftTier(t.token_id).catch(() => null)));
  return <IdentityView tokens={tokens} tiers={tiers} />;
}
