/**
 * Privy embedded-wallet signer, as in NEAR's Privy tutorial ("Direct Privy" tab) and its example:
 * https://docs.near.org/web3-apps/tutorials/privy
 * https://github.com/near-examples/hello-privy/blob/5aa847ac74551dbfdeb6dc7f5ace4ed0b105c5d8/src/context/signer.ts
 * near-api-js serializes and hashes transactions and NEP-413 messages; Privy signs the hash in-page.
 */
import { Account, PublicKey, Signer } from "near-api-js";
import type { JsonRpcProvider } from "near-api-js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

export type SignRawHash = (input: { address: string; chainType: "near"; hash: `0x${string}` }) => Promise<{ signature: string }>;

export const isImplicit = (id: string) => /^[a-f0-9]{64}$/i.test(id);

export class PrivySigner extends Signer {
  constructor(private signRawHash: SignRawHash, private nearAccId: string, private provider: JsonRpcProvider) { super(); }

  async getPublicKey() {
    if (isImplicit(this.nearAccId)) return new PublicKey({ keyType: 0, data: hexToBytes(this.nearAccId) });
    const account = new Account(this.nearAccId, this.provider);
    const { keys } = await account.getAccessKeyList();
    if (!keys.length) throw new Error("The account has no registered access key");
    return PublicKey.fromString(keys[0].public_key);
  }

  async signBytes(bytes: Uint8Array) {
    const { signature } = await this.signRawHash({ address: this.nearAccId, chainType: "near", hash: `0x${bytesToHex(bytes)}` });
    return hexToBytes(signature.replace(/^0x/, ""));
  }
}
