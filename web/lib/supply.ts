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
 *
 * Stale-while-revalidate: the last verified snapshot is kept in memory and served ONLY when the chain
 * cannot be reached at all (fetch throws / times out / the node errors). A logical failure — reads that
 * land on different blocks, or values that fail validation — still returns null, never a stale number.
 * The value is always a real on-chain read with its real block hash; it is never invented, and it is
 * never 0 as a stand-in. This exists because the public FastNear RPC throttles under the e2e suite's
 * load: without it the home stat flips to "—" for 15 s+ mid-run and the viewport test fails.
 */
let lastGood: SupplySnapshot | null = null;

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
    if (!snap) return null;
    lastGood = { ...snap, block_hash: pin.blockHash };
    return lastGood;
  } catch { return lastGood; }
}

export async function readHolderKeys(opts?: ViewOpts): Promise<number | null> {
  const snap = await readHolderSupply(opts);
  return snap ? snap.supply : null;
}
