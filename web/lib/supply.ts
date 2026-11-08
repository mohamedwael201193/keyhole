import { KEYS_CONTRACT } from "./config";
import { view } from "./near";
import type { ViewOpts } from "./rpc";

/**
 * Keys on mainnet, for the home stat: the contract's total supply (NEP-181 nft_total_supply), as read. This is a count of keys,
 * not of distinct holders, and it includes the test key the contract account holds (KEYHOLE Key #0). Live on every call unless
 * `opts.shared` is set.
 */
export async function readKeySupply(opts?: ViewOpts): Promise<number | null> {
  try {
    const total = await view<string>("nft_total_supply", {}, KEYS_CONTRACT, opts);
    const n = Number(total);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch { return null; }
}
