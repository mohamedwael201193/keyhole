import { KEYS_CONTRACT } from "./config";
import { view } from "./near";

/**
 * Keys held by people, for the home stat. Total minted (NEP-181 nft_total_supply) minus the tokens the
 * contract account itself holds (the test key, KEYHOLE Key #0). Both reads are live on every request.
 */
export async function readHolderKeys(): Promise<number | null> {
  try {
    const [total, own] = await Promise.all([
      view<string>("nft_total_supply"),
      view<string>("nft_supply_for_owner", { account_id: KEYS_CONTRACT }),
    ]);
    const n = Number(total) - Number(own);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch { return null; }
}
