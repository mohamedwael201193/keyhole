import { Landing } from "@/components/Landing";
import { contractConfig } from "@/lib/near";
import { readSupply } from "@/lib/supply";
import { WORKER_WASM_SHA256 } from "@/lib/config";

export const revalidate = 30;
export default async function Home() {
  const [supply, config] = await Promise.all([readSupply(), contractConfig().catch(() => null)]);
  return <Landing supply={supply} hash={WORKER_WASM_SHA256[0].slice(0, 8)} config={config} />;
}
