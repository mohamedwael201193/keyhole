import { KEYS_CONTRACT } from "./config";
import { nearViewMeta, type ViewOpts } from "./rpc";

export type SupplySnapshot = { supply: number; minted: number; excluded_test_keys: number; block_hash: string };

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
  return { supply: minted - excluded, minted, excluded_test_keys: excluded, block_hash: "" };
}

/**
 * Keys held by people, for the home stat. Total minted (NEP-181 nft_total_supply) minus the tokens the
 * contract account itself holds (the test key, KEYHOLE Key #0). Both reads use one finalized block hash.
 */
export async function readHolderSupply(opts?: ViewOpts): Promise<SupplySnapshot | null> {
  try {
    const pinOpts = { timeoutMs: opts?.timeoutMs, shared: false as const };
    const pin = await nearViewMeta<string>("nft_total_supply", {}, KEYS_CONTRACT, pinOpts);
    if (!pin.blockHash) return null;
    const at = { ...pinOpts, blockId: pin.blockHash };
    const [total, own] = await Promise.all([
      nearViewMeta<string>("nft_total_supply", {}, KEYS_CONTRACT, at),
      nearViewMeta<string>("nft_supply_for_owner", { account_id: KEYS_CONTRACT }, KEYS_CONTRACT, at),
    ]);
    if (total.blockHash !== pin.blockHash || own.blockHash !== pin.blockHash) return null;
    const snap = holderSupply(String(total.value), String(own.value));
    return snap ? { ...snap, block_hash: pin.blockHash } : null;
  } catch { return null; }
}

export async function readHolderKeys(opts?: ViewOpts): Promise<number | null> {
  const snap = await readHolderSupply(opts);
  return snap ? snap.supply : null;
}
