import { Landing } from "@/components/Landing";
import { contractConfig } from "@/lib/near";
import { readHolderKeys } from "@/lib/supply";
import { WORKER_WASM_SHA256 } from "@/lib/config";

// Rendered per request (chain reads are cached 60 s in lib/rpc.ts), so `next build` never waits on the network.
export const dynamic = "force-dynamic";
export default async function Home() {
  const [supply, config] = await Promise.all([readHolderKeys(), contractConfig().catch(() => null)]);
  return <Landing supply={supply} hash={WORKER_WASM_SHA256[0].slice(0, 8)} config={config} />;
}
