import type {SignedAuth} from "./nep413";
import type {IntentIdentity,IntentStore} from "./pledgeIntentStore";
export type ExitRecord=IntentIdentity&{account:string;token:string;epoch:string;amount:string;value_op_id?:string;status:"AwaitingSignature"|"Retryable"|"UNKNOWN"|"Pending";intent?:"withdraw"|"reconcile_value_op"};
export const PLEDGE_EXIT_USDC="nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const retryableExit=(op:ExitRecord|null)=>!!op&&op.intent==="withdraw"&&!op.value_op_id&&["AwaitingSignature","Retryable"].includes(op.status);
/** An unsent signature is regenerable from the immutable intent. Auth is never stored in localStorage. */
export async function dispatchExitContinuation<T>(auth:SignedAuth,original:ExitRecord,store:IntentStore<ExitRecord>,preflight:()=>void,send:(auth:SignedAuth)=>Promise<T>,consumeAuth:()=>void=()=>{}):Promise<{result:T;pending:ExitRecord}> {
 if(!retryableExit(original))throw Error("Original exit may already have been dispatched; reconcile only.");
 const request=JSON.parse(auth.message),p=request.params;
 // Reject an ABA continuation BEFORE any mutation, even when every economic field is identical.
 if(!original.id||p?.intent_id!==original.id)throw Error("Signature belongs to another exit intent. Sign this saved intent again.");
 let pending=original,dispatched=false;
 try {
  if(auth.account_id!==original.account)throw Error("Exit signer changed. Sign the original intent again.");
  if(request.op!=="withdraw"||request.account_id!==original.account||p?.token_id!==original.token||p?.owner_epoch!==original.epoch||p?.amount!==original.amount||p?.to!==original.account||p?.chain!=="near"||p?.token!==PLEDGE_EXIT_USDC)throw Error("Signature does not match the original exit intent.");
  preflight();
  const next:ExitRecord={...original,status:"UNKNOWN"};
  if(!await store.replace(original,next))throw Error("Exit intent changed in another tab; nothing new was dispatched.");
  pending=next;
  // Recheck after the cross-tab storage await, immediately before invoking the worker.
  preflight();
  consumeAuth();dispatched=true;
  return {result:await send(auth),pending};
 }catch(error){
  if(!dispatched){
   const retry:ExitRecord={...pending,status:"Retryable"};
   if(await store.replace(pending,retry))consumeAuth(); // safe only AFTER durable regeneration state
  }
  throw error;
 }
}
