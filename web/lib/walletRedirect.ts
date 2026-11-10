import {signedCallbackUrl,verifyAuth,type SignedAuth} from "./nep413";
import {NEP413_RECIPIENT} from "./config";
/** A URL signature is never paired with a newer pending message/nonce without local cryptographic proof.
 * This verifies the signed challenge, not native ownership: the worker still performs its independent key lookup. */
export function parseWalletRedirect<Context=unknown>(saved:string,hash:string):(SignedAuth & {ctx?:Context})|null {
 try {
  if(saved.length>32768||hash.length>8192)return null;
  const s=JSON.parse(saved) as {message:string;nonce:string;callbackUrl?:string;ctx?:Context},h=new URLSearchParams(hash.replace(/^#/,""));
  if(typeof s.message!=="string"||typeof s.nonce!=="string")return null;
  const signed:SignedAuth={account_id:h.get("accountId")||"",public_key:h.get("publicKey")||"",signature:h.get("signature")||"",nonce:s.nonce,message:s.message,recipient:NEP413_RECIPIENT};
  if(!signed.account_id||JSON.parse(s.message).account_id!==signed.account_id)return null;
  const cb=typeof s.callbackUrl==="string"?signedCallbackUrl(signed,s.callbackUrl):undefined;
  const auth=cb?{...signed,callback_url:cb}:signed;
  if(!verifyAuth(auth))return null; // also reject an invalid signature when the wallet omitted callbackUrl
  return {...auth,ctx:s.ctx};
 }catch{return null;}
}
