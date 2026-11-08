import { KEYS_CONTRACT } from "./config";
import { view } from "./near";
import type { ViewOpts } from "./rpc";

/**
 * Keys held by people, for the home stat. Total minted (NEP-181 nft_total_supply) minus the tokens the
 * contract account itself holds (the test key, KEYHOLE Key #0). Live on every call unless `opts.shared` is set.
 */
export async function readHolderKeys(opts?: ViewOpts): Promise<number | null> {
  try {
    const [total, own] = await Promise.all([
      view<string>("nft_total_supply", {}, KEYS_CONTRACT, opts),
      view<string>("nft_supply_for_owner", { account_id: KEYS_CONTRACT }, KEYS_CONTRACT, opts),
    ]);
    const n = Number(total) - Number(own);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch { return null; }
}
