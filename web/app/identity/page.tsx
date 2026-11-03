import { nftTier, nftTokens } from "@/lib/near";
import { IdentityView } from "./view";
// Rendered per request (chain reads are cached 60 s in lib/rpc.ts), so `next build` never waits on the network.
export const dynamic = "force-dynamic";
export const metadata = { title: "Identity · KEYHOLE" };
export default async function Page() {
  const tokens = await nftTokens().catch(() => []);
  const tiers = await Promise.all(tokens.map((t) => nftTier(t.token_id).catch(() => null)));
  return <IdentityView tokens={tokens} tiers={tiers} />;
}
