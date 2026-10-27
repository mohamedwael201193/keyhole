import { Hero } from "@/components/Hero";
import { HowAndProof } from "@/components/HowAndProof";
import { contractConfig, nftSupply } from "@/lib/near";

export const revalidate = 30;
export default async function Home() {
  const [supply, config] = await Promise.all([nftSupply().catch(() => null), contractConfig().catch(() => null)]);
  return (<><Hero supply={supply == null ? null : Number(supply)} /><HowAndProof supply={supply == null ? null : Number(supply)} config={config} /></>);
}
