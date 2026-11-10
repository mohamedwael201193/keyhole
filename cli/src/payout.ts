import { Account, JsonRpcProvider, KeyPairSigner, actions } from "near-api-js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { contractView, DEFAULTS, type Key } from "./core.js";
import { isMethodNotFound } from "./rpcError.js";
export type PayoutCall = { method: string; deposit: string; gas: string };
export async function payout(key: Key, mode: "status" | "register" | "claim", consentedCost?: string,
  read: typeof contractView = contractView, execute: (call: PayoutCall) => Promise<unknown> = async call => {
    const secret = new Uint8Array(64); secret.set(key.secret); secret.set(ed25519.getPublicKey(key.secret),32);
    const signer = KeyPairSigner.fromSecretKey(`ed25519:${bs58.encode(secret)}`);
    const account = new Account(key.accountId, new JsonRpcProvider({url:DEFAULTS.rpc}), signer);
    return account.signAndSendTransaction({receiverId:DEFAULTS.contract,actions:[actions.functionCall(call.method,{},BigInt(call.gas),BigInt(call.deposit))],throwOnFailure:true});
  }) {
  let cost: string;
  try { cost = await read<string>("payout_storage_cost",{}); }
  catch(e) { if (isMethodNotFound(e)) return {supported:false,delivery:"Legacy v2.4 native refunds; no payout slot methods"}; throw e; }
  const registered = await read<boolean>("payout_account_registered",{account_id:key.accountId});
  const credit = await read<string>("get_payout_credit",{account_id:key.accountId});
  const pending = await read<unknown>("get_pending_payout",{account_id:key.accountId});
  if (typeof cost !== "string" || !/^[1-9]\d*$/.test(cost) || typeof registered !== "boolean" || typeof credit !== "string" || !/^\d+$/.test(credit)) throw new Error("Invalid payout state");
  const state={supported:true,registered,nonrefundable_storage_yocto:cost,available_credit_yocto:credit,pending};
  if(mode === "status") return state;
  if(mode === "register" && (registered || consentedCost !== cost)) throw new Error(`Explicit consent required: --accept-storage-yocto ${cost}. Permanent, nonrefundable; never silently sponsored. Already registered slots cannot be purchased again.`);
  if(mode === "claim" && (!registered || pending || BigInt(credit)===0n)) throw new Error("No claimable credit or payout already pending. UNKNOWN cannot be retried/refunded by timeout.");
  const result = await execute({method:mode==="register"?"register_payout_account":"claim_payout",deposit:mode==="register"?cost:"1",gas:mode==="register"?"30000000000000":"70000000000000"});
  return {...state,result,delivery:"Transaction outcome only: inspect final native-transfer and on_payout receipts before treating credit as delivered cash. A failed callback or pending nonce is not delivery."};
}
