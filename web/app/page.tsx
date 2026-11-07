import { Landing } from "@/components/Landing";
import { nftTier, nftTokens, type Token } from "@/lib/near";
import { readHolderKeys } from "@/lib/supply";
import { WORKER_WASM_SHA256 } from "@/lib/config";

// Rendered per request (chain reads are cached 60 s in lib/rpc.ts), so `next build` never waits on the network.
export const dynamic = "force-dynamic";
export default async function Home() {
  const [supply, tokens] = await Promise.all([
    readHolderKeys(),
    nftTokens(0, 12).catch((): Token[] => []),
  ]);
  const tiers = await Promise.all(tokens.map((t) => nftTier(t.token_id).catch(() => null)));
  return <Landing supply={supply} hash={WORKER_WASM_SHA256[0].slice(0, 8)} tokens={tokens} tiers={tiers} />;
}
