// Chain Signatures (v1.signer, domain 0) key derivation in the browser: the same rule as
// tee/worker/src/chainsig.rs, so /key can show a key NFT's EVM address without trusting the worker.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha3_256, keccak_256 } from "@noble/hashes/sha3.js";
import bs58 from "bs58";

export const ROOT_PK = "secp256k1:3tFRbMqmoa6AAALMrEFAYCEoHcqKxeW38YptwowBVBtXK1vo36HDbUWuR6EZmoK4JcH6HDkNMGGqP1ouV7VZUWya";
export const TEE_MINTER = "015a025906a59f9f40ca17daf2a3c61c5e63a37c081c75230870caa6a82ac443";
const P = secp256k1.Point;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export const pathFor = (tokenId: string) => (/^k[0-9a-f]{16}$/.test(tokenId) ? `keyhole/key/${tokenId}` : null);
export function epsilon(predecessor: string, path: string): bigint {
  return BigInt("0x" + hex(sha3_256(new TextEncoder().encode(`near-mpc-recovery v0.1.0 epsilon derivation:${predecessor},${path}`))));
}
export function parsePk(s: string) {
  if (!s.startsWith("secp256k1:")) return null;
  const raw = bs58.decode(s.slice(10));
  if (raw.length !== 64) return null;
  try { return P.fromHex("04" + hex(raw)); } catch { return null; }
}
export const fmtPk = (p: InstanceType<typeof P>) => "secp256k1:" + bs58.encode(p.toBytes(false).slice(1));
export function derive(root: InstanceType<typeof P>, predecessor: string, path: string) {
  return P.BASE.multiply(epsilon(predecessor, path) % P.CURVE().n).add(root);
}
export function evmAddress(p: InstanceType<typeof P>): string {
  const lower = hex(keccak_256(p.toBytes(false).slice(1)).slice(12));
  const ch = hex(keccak_256(new TextEncoder().encode(lower)));
  return "0x" + [...lower].map((c, i) => (parseInt(ch[i], 16) >= 8 ? c.toUpperCase() : c)).join("");
}
/** EVM address of a key NFT's Chain Signatures account (predecessor = TEE minter). */
export function keyEvmAddress(tokenId: string): string | null {
  const path = pathFor(tokenId); const root = parsePk(ROOT_PK);
  return path && root ? evmAddress(derive(root, TEE_MINTER, path)) : null;
}
