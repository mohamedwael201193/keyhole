import { getHealth } from "@/lib/health";
import { tokenPrices } from "@/lib/tokenPrices";
import { VaultView } from "./view";
export const revalidate = 60;
export default async function Page() {
  const [health, prices] = await Promise.all([getHealth(), tokenPrices()]);
  return <VaultView initialOnline={health.online} initialPrices={prices} />;
}
