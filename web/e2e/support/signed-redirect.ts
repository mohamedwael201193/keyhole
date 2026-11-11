/** Test-only signature material, not an account key. Worker/network transports in these UI tests are explicit mocks. */
import {ed25519} from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import {buildMessage,payloadHash,toB64} from "../../lib/nep413";
export function fixtureRedirect(op:"swap"|"withdraw"|"exact_near_exit_v1"|"balance",ctx?:Record<string,unknown>,n=1){
 const seed=new Uint8Array(32).fill(9),nonce=new Uint8Array(32).fill(n),account="holder.keyhole.test",message=buildMessage(op,account,{});
 const publicKey="ed25519:"+bs58.encode(ed25519.getPublicKey(seed)),signature=toB64(ed25519.sign(payloadHash(message,nonce,"keyhole"),seed));
 return {saved:JSON.stringify({message,nonce:toB64(nonce),ctx}),hash:"#"+new URLSearchParams({accountId:account,publicKey,signature})};
}