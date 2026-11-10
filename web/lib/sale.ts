/**
 * Key sale (contract v2.4): the chain reads, feature detection and the pure rules the sale card and the gallery use.
 * Every number here comes from the contract (listing, config) or from the user's typed price. Nothing is estimated on chain.
 */
import { KEYS_CONTRACT } from "./config";
import { nearView } from "./rpc";
import { toBaseUnits } from "./assets";

/** Contract limits (contracts/keys/src/lib.rs): 0.1 NEAR minimum, 100 000 NEAR cap. */
export const MIN_PRICE_YOCTO = 10n ** 23n;
export const MAX_PRICE_YOCTO = 100_000n * 10n ** 24n;
/** The storage deposit a new listing takes. Returned to the seller when the listing ends. */
export const LIST_DEPOSIT_YOCTO = 10n ** 22n;
export const ROYALTY_BPS_CAP = 1000;

export type Listing = { token_id: string; seller: string; price: string };

/** Whether the keys contract has the sale methods. "unknown" when the probe failed for another reason (network, RPC). */
export type SaleSupport = "checking" | "open" | "v23" | "unknown";

/** A MethodNotFound from the RPC means the deployed contract predates v2.4 (no sale methods). Anything else is unknown. */
export function supportFromError(message: string): "v23" | "unknown" {
  return /MethodNotFound|MethodResolveError|method not found/i.test(message) ? "v23" : "unknown";
}

/** Reads nft_listings with limit 1. Resolves "open" or "v23"; a failed read resolves "unknown" (never "v23"). */
export async function probeSaleSupport(): Promise<SaleSupport> {
  try {
    await nearView<Listing[]>("nft_listings", { limit: 1 }, KEYS_CONTRACT, { shared: true });
    return "open";
  } catch (e) {
    return supportFromError(e instanceof Error ? e.message : String(e));
  }
}

/** The listing of one key, read fresh (never from the 60 s public cache, so a sale or unlist shows at once). */
export const readListing = (id: string) => nearView<Listing | null>("nft_listing", { token_id: id }, KEYS_CONTRACT, { shared: false });
/** Listed keys, in index order, one page. */
export const readListings = (from = 0, limit = 50) => nearView<Listing[]>("nft_listings", { from_index: String(from), limit }, KEYS_CONTRACT, { shared: false });

/** Parses a NEAR amount typed by the user into yoctoNEAR, with the contract's limits. */
export function parsePriceNear(input: string): { ok: true; yocto: bigint } | { ok: false; reason: string } {
  const v = input.trim();
  if (!v) return { ok: false, reason: "Enter a price in NEAR, for example 5." };
  const units = toBaseUnits(v, 24);
  if (!units || !/^\d+$/.test(units)) return { ok: false, reason: "Enter a price in NEAR, for example 5 or 0.25." };
  const yocto = BigInt(units);
  if (yocto < MIN_PRICE_YOCTO) return { ok: false, reason: "The minimum price is 0.1 NEAR." };
  if (yocto > MAX_PRICE_YOCTO) return { ok: false, reason: "The maximum price is 100000 NEAR." };
  return { ok: true, yocto };
}

/** yoctoNEAR to plain NEAR text with every decimal kept and trailing zeros dropped: "5", "0.25", "0.0001". */
export function nearText(yocto: bigint | string): string {
  const y = typeof yocto === "bigint" ? yocto : BigInt(yocto);
  const s = y.toString().padStart(25, "0");
  const whole = s.slice(0, -24).replace(/^0+(?=\d)/, "");
  const frac = s.slice(-24).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** The royalty the contract takes from a sale, rounded down as the contract does (price * bps / 10 000). */
export function royaltyOf(price: bigint, bps: number): bigint {
  return (price * BigInt(bps)) / 10_000n;
}

/** What the seller receives from a sale, not counting the listing deposit (which comes back when the listing ends). */
export function sellerNetOf(price: bigint, bps: number): bigint {
  return price - royaltyOf(price, bps);
}

/** Royalty as a percentage text with two decimals at most: 5% is "5%", 2.5% is "2.5%". */
export function royaltyPercentText(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0$/, "")}%`;
}

export type BuyState = {
  signedIn: boolean;
  accountId: string | null;
  /** The chain owner of the key, or undefined while it is read. */
  owner: string | null | undefined;
  listing: Listing;
  /** Whether this wallet already holds a key (one key per account). */
  holdsKey: boolean;
  /** The key store is still reading this wallet's keys. */
  keysLoading: boolean;
};

/** The reason the visitor cannot buy this listing right now, or null when they can. Plain words, one reason. */
export function buyBlockReason(s: BuyState): string | null {
  if (!s.signedIn || !s.accountId) return "Sign in to buy this key.";
  if (s.owner === undefined) return "Reading the holder from NEAR first.";
  if (s.listing.seller === s.accountId) return "You are the seller. Unlist the key to take it back.";
  if (s.owner !== s.listing.seller) return "This listing is out of date: the seller no longer holds the key. It cannot be bought.";
  if (s.keysLoading) return "Checking whether this wallet already holds a key.";
  if (s.holdsKey) return "This wallet already holds a key. One key per account.";
  return null;
}

/**
 * What a new listing needs in the seller's account: the 0.01 NEAR storage deposit (returned when the listing ends) plus gas
 * for nft_list (30 TGas, see lib/keysTx.ts). Measured estimate, rounded up to 0.011 NEAR.
 */
export const LIST_MIN_BALANCE_YOCTO = 11n * 10n ** 21n;
export const LIST_BALANCE_TEXT = "You need about 0.011 NEAR in this account to list (0.01 NEAR refundable deposit + gas). On v2.5, first register the separate 0.0032 NEAR nonrefundable payout slot; sale and refund credits need a later cashout.";

/** The reason the holder cannot list or change this key's price right now, or null. `balance` is the account's NEAR, read fresh. */
export function listBlockReason(s: {
  signedIn: boolean;
  accountId: string | null;
  owner: string | null | undefined;
  royaltyBps: number | null | undefined;
  balance: bigint | null | undefined;
}): string | null {
  if (!s.signedIn || !s.accountId) return "Sign in with the wallet that holds this key.";
  if (s.owner === undefined) return "Reading the holder from NEAR first.";
  if (s.owner !== s.accountId) return "Only the current holder can list this key.";
  if (s.royaltyBps == null) return "The royalty could not be read from NEAR just now. Try again in a moment.";
  if (s.balance === undefined) return "Reading this account's NEAR balance first.";
  if (s.balance === null) return "This account's NEAR balance could not be read just now. Try again in a moment.";
  if (s.balance < LIST_MIN_BALANCE_YOCTO) return LIST_BALANCE_TEXT;
  return null;
}

/** Whether a visitor is the holder of this key on chain. */
export const isHolder = (accountId: string | null, owner: string | null | undefined) => !!accountId && !!owner && accountId === owner;
