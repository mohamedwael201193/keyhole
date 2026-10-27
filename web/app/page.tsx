import { Landing } from "@/components/Landing";
import { contractConfig, nftSupply } from "@/lib/near";
import { WORKER_WASM_SHA256 } from "@/lib/config";

export const revalidate = 30;
export default async function Home() {
  const [supply, config] = await Promise.all([nftSupply().catch(() => null), contractConfig().catch(() => null)]);
  return <Landing supply={supply == null ? null : Number(supply)} hash={WORKER_WASM_SHA256[0].slice(0, 8)} config={config} />;
}
