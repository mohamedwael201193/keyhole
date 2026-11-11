/**
 * Public record of the testnet keys contract. The wasm is contracts/keys/release/v2.7
 * (code hash 3cZsaySYgqZntFaRKEUffQUMGqRjkQ2DuSmFWXwiKGZH). Deployment facts: docs/trial/testnet.json.
 * This module is safe to import from the browser. It has no secret.
 */
export const TRIAL_CONTRACT = "keyhole-trial-mwcjsmqw.testnet";
export const TRIAL_CODE_HASH = "3cZsaySYgqZntFaRKEUffQUMGqRjkQ2DuSmFWXwiKGZH";
export const TRIAL_WASM_SHA256 = "26d3deeff8a4445515d6356097bd7634e8b26deaee7e7ea1ebe47849b807c08c";
export const TRIAL_NETWORK = "testnet" as const;
export const TRIAL_BANNER = "Testnet · free · not real money";
/** Attached to each sponsored create_account. The trial copy and the recorded deployment quote this constant. */
export const GUEST_DEPOSIT_YOCTO = "250000000000000000000000";
export const TRIAL_SPONSOR = "keyhole-trial-sponsor-b32ffa7796.testnet";
/**
 * Nonce of the sponsor's full-access key when that key was created.
 * NEAR sets a new access key's nonce to block_height * 1e6, so the absolute nonce is never a small counter.
 * Trial spends are (current nonce - this base). https://docs.near.org/protocol/access-keys
 */
export const SPONSOR_NONCE_BASE = 277265680000000n;
/** Official testnet RPC, then the public fallback. Neither URL is mainnet. */
export const TESTNET_RPCS = ["https://rpc.testnet.near.org", "https://test.rpc.fastnear.com"] as const;
/** Testnet indexer. The mainnet host returns an empty list for these accounts and must not be used as a quota. */
export const TESTNET_INDEXERS = ["https://api-testnet.nearblocks.io"] as const;

export function isTestnetRpc(url: string): boolean {
  let host = "";
  try { host = new URL(url).hostname; } catch { return false; }
  if (host.includes("mainnet")) return false;
  return host === "rpc.testnet.near.org" || host === "test.rpc.fastnear.com";
}

export function testnetTx(hash: string): string | null {
  return /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash) ? `https://testnet.nearblocks.io/txns/${hash}` : null;
}

export function testnetAccount(id: string): string {
  return `https://testnet.nearblocks.io/address/${encodeURIComponent(id)}`;
}
