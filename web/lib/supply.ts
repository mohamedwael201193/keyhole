import { view } from "./near";

/** Keys minted, for the hero. Uses the shared public-read cache (about 60 s). */
export async function readSupply(): Promise<number | null> {
  try {
    const n = Number(await view<string>("nft_total_supply"));
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch { return null; }
}
