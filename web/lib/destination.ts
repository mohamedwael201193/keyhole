// Generic chain/address format helpers. These do not authorize a withdrawal.
// Withdrawals are restricted independently to the current holder on NEAR.
import bs58 from "bs58";
import { validAccountId } from "./keysApi";

/** Chains whose addresses are 0x followed by 40 hex digits. */
export const EVM_CHAINS: ReadonlySet<string> = new Set(["eth", "base", "arb", "bsc", "op", "pol", "avax", "gnosis", "hood", "abs", "bera", "monad", "plasma", "xlayer", "scroll"]);

/**
 * The chain a 1Click asset id pays out on. An omft token carries its chain in the id: nep141:base-0x….omft.near is base.
 * Every other asset id here is a NEAR token.
 */
export function chainOfAsset(assetId: string): string {
  const m = /^nep141:([a-z0-9]+)-[^.]+\.omft\.near$/i.exec(assetId);
  return m ? m[1].toLowerCase() : "near";
}

export type DestCheck = { ok: true } | { ok: false; reason: string };

/** The address a withdrawal to this chain starts with: the signed-in account when it is a NEAR account, otherwise nothing. */
export function defaultDestination(chain: string, accountId: string): string {
  return chain === "near" && validAccountId(accountId) ? accountId : "";
}

/** Per-chain format check. NEAR: a named or implicit account id. EVM: 0x and 40 hex digits. Solana: a 32-byte base58 key. */
export function validDestination(chain: string, address: string): DestCheck {
  const a = address.trim();
  if (a === "") return { ok: false, reason: "Enter the address to withdraw to." };
  if (chain === "near") return validAccountId(a) ? { ok: true } : { ok: false, reason: "Enter a NEAR account, for example name.near." };
  if (EVM_CHAINS.has(chain)) return /^0x[0-9a-fA-F]{40}$/.test(a) ? { ok: true } : { ok: false, reason: "Enter a 0x address: 0x and 40 hex characters." };
  if (chain === "sol") {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return { ok: false, reason: "Enter a Solana address: base58 characters." };
    try { return bs58.decode(a).length === 32 ? { ok: true } : { ok: false, reason: "That is not a complete Solana address." }; }
    catch { return { ok: false, reason: "That is not a valid Solana address." }; }
  }
  return { ok: false, reason: "Withdrawals to this chain are not offered yet." };
}
