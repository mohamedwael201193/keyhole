import { KEYS_CONTRACT } from "./config";
import { view } from "./near";
import type { ViewOpts } from "./rpc";

export type SupplySnapshot = { supply: number; minted: number; excluded_test_keys: number };

/**
 * One finalized pair of views. `supply` is keys held by people: minted minus the contract-held test key.
 * A failed read, a negative result, or an unsafe integer is null. Never 0 as a stand-in for failure.
 */
export function holderSupply(total: string, own: string): SupplySnapshot | null {
  if (!/^\d+$/.test(total) || !/^\d+$/.test(own)) return null;
  const minted = Number(total);
  const excluded = Number(own);
  if (!Number.isSafeInteger(minted) || !Number.isSafeInteger(excluded)) return null;
  if (excluded > minted) return null;
  return { supply: minted - excluded, minted, excluded_test_keys: excluded };
}

/**
 * Keys held by people, for the home stat. Total minted (NEP-181 nft_total_supply) minus the tokens the
 * contract account itself holds (the test key, KEYHOLE Key #0). Live on every call unless `opts.shared` is set.
 */
export async function readHolderSupply(opts?: ViewOpts): Promise<SupplySnapshot | null> {
  try {
    const [total, own] = await Promise.all([
      view<string>("nft_total_supply", {}, KEYS_CONTRACT, opts),
      view<string>("nft_supply_for_owner", { account_id: KEYS_CONTRACT }, KEYS_CONTRACT, opts),
    ]);
    return holderSupply(String(total), String(own));
  } catch { return null; }
}

export async function readHolderKeys(opts?: ViewOpts): Promise<number | null> {
  const snap = await readHolderSupply(opts);
  return snap ? snap.supply : null;
}
