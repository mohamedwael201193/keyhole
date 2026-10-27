import { sha256 } from "@noble/hashes/sha2.js";
import { KEYS_CONTRACT } from "./config";

export const FINISHES = ["Bronze", "Silver", "Gold", "Legendary"] as const;
export type Finish = (typeof FINISHES)[number];

export const FINISH_COLOR: Record<Finish, string> = {
  Bronze: "#8A5A3C",
  Silver: "#6E7A80",
  Gold: "#9A7420",
  Legendary: "#7A1F4F",
};

/**
 * Caps the enclave enforces (tee/worker limits_for_tier).
 * Legendary is a rare finish on a Gold-cap key. It is not a fourth limit.
 */
export const CAPS: Record<Finish, { perTx: number; daily: number; perMin: number }> = {
  Bronze: { perTx: 1, daily: 5, perMin: 6 },
  Silver: { perTx: 10, daily: 50, perMin: 12 },
  Gold: { perTx: 100, daily: 500, perMin: 30 },
  Legendary: { perTx: 100, daily: 500, perMin: 30 },
};

export interface CatalogKey {
  n: number;
  finish: Finish;
  head: string;
  filigree: string;
  enamel: string;
  gem: string;
  shaft: string;
}

/** The ten key artworks. Traits are paired with the picture so the card matches the metal. */
export const CATALOG: CatalogKey[] = [
  { n: 1, finish: "Legendary", head: "Crown", filigree: "Peacock", enamel: "Emerald · Teal", gem: "Diamond", shaft: "Stars" },
  { n: 2, finish: "Gold", head: "Shield", filigree: "Acanthus", enamel: "Ruby · Ivory", gem: "Ruby cabochon", shaft: "Spiral" },
  { n: 3, finish: "Bronze", head: "Trefoil", filigree: "Lotus", enamel: "Teal · Coral", gem: "Amber", shaft: "Fluted" },
  { n: 4, finish: "Silver", head: "Rosette", filigree: "Iris", enamel: "Sapphire · White", gem: "Sapphire", shaft: "Rope twist" },
  { n: 5, finish: "Bronze", head: "Heart", filigree: "Ivy", enamel: "Olive · Cream", gem: "Garnet", shaft: "Dotted" },
  { n: 6, finish: "Silver", head: "Gothic arch", filigree: "Tracery", enamel: "Lilac · Mint", gem: "Pearl", shaft: "Chevron" },
  { n: 7, finish: "Gold", head: "Sunburst", filigree: "Rays", enamel: "Cobalt · White", gem: "Citrine", shaft: "Laurel" },
  { n: 8, finish: "Bronze", head: "Quatrefoil", filigree: "Waves", enamel: "Turquoise · Onyx", gem: "Onyx", shaft: "Wave scroll" },
  { n: 9, finish: "Silver", head: "Star", filigree: "Snowflake", enamel: "Ice · White", gem: "Moonstone", shaft: "Knurl" },
  { n: 10, finish: "Legendary", head: "Phoenix", filigree: "Flame feather", enamel: "Crimson · Gold", gem: "Fire opal", shaft: "Feathers" },
];

const POOLS: Record<Finish, number[]> = {
  Bronze: [3, 5, 8],
  Silver: [4, 6, 9],
  Gold: [2, 7],
  Legendary: [1, 10],
};

export function traitSeed(contractId: string, tokenId: string): Uint8Array {
  return sha256(new TextEncoder().encode(contractId + tokenId));
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Eight-bit cipher of the token id, drawn as bars.
 * Numeric ids use their own integer (so #1 is 00000001, matching the art set).
 * Other ids use the last hex byte embedded in the id.
 */
export function bitCipherBits(tokenId: string): string {
  if (/^\d+$/.test(tokenId)) return (BigInt(tokenId) & 0xffn).toString(2).padStart(8, "0");
  const hex = tokenId.toLowerCase().replace(/[^0-9a-f]/g, "");
  const byte = hex.length >= 2 ? parseInt(hex.slice(-2), 16) : 0;
  return byte.toString(2).padStart(8, "0");
}

/** Legendary is rare: 1 in 8 Gold-cap keys (on-chain tier 3). Caps stay Gold. */
export function finishOf(tier: number | null, seed: Uint8Array): Finish {
  if (tier === 3 && (seed[1] & 7) === 0) return "Legendary";
  if (tier === 3) return "Gold";
  if (tier === 2) return "Silver";
  return "Bronze";
}

export interface KeyIdentity {
  art: number;
  finish: Finish;
  head: string;
  filigree: string;
  enamel: string;
  gem: string;
  shaft: string;
  bits: string;
  seedHex: string;
  perTx: number;
  daily: number;
  perMin: number;
}

/** Deterministic identity: sha256(contract_id + token_id) picks the artwork inside the finish's set. */
export function keyIdentity(tokenId: string, tier: number | null, contractId = KEYS_CONTRACT): KeyIdentity {
  const seed = traitSeed(contractId, tokenId);
  const finish = finishOf(tier, seed);
  const pool = POOLS[finish];
  const art = pool[seed[0] % pool.length];
  const spec = CATALOG[art - 1];
  const caps = CAPS[finish];
  return {
    art, finish,
    head: spec.head, filigree: spec.filigree, enamel: spec.enamel, gem: spec.gem, shaft: spec.shaft,
    bits: bitCipherBits(tokenId), seedHex: toHex(seed),
    perTx: caps.perTx, daily: caps.daily, perMin: caps.perMin,
  };
}

/** NEP-177-style metadata the site renders. `media` is this site's key art, not an invented CID. */
export function nep177(tokenId: string, tier: number | null, contractId = KEYS_CONTRACT) {
  const id = keyIdentity(tokenId, tier, contractId);
  const titleId = /^\d+$/.test(tokenId) ? `#${tokenId}` : tokenId;
  return {
    title: `KEYHOLE Key ${titleId}`,
    description: "Viewing key to a confidential account in an Intel TDX enclave.",
    media: `/heirloom/keys/k${String(id.art).padStart(2, "0")}.webp`,
    extra: {
      tier: id.finish,
      caps_usd: { per_trade: id.perTx, per_day: id.daily },
      traits: { head: id.head, filigree: id.filigree, enamel: id.enamel, gem: id.gem, shaft: id.shaft, bit_cipher: id.bits },
      seed: "sha256(contract ‖ token_id)",
      seed_hex: id.seedHex,
    },
  };
}

export const keySrc = (n: number) => `/heirloom/keys/k${String(n).padStart(2, "0")}`;
