import type {SignedAuth} from "./nep413";
import {createBrowserIntentStore,browserIntentEnvironment,pledgeLifecycleScope,type IntentIdentity,type IntentStore,type IntentEnvironment} from "./pledgeIntentStore";
import {browserMoneyStore,opensLoan} from "./pledgeMoney";
export type ExitRecord=IntentIdentity&{account:string;token:string;epoch:string;amount:string;continuation?:ExitContinuation;value_op_id?:string;status:"AwaitingSignature"|"Retryable"|"UNKNOWN"|"Pending";intent?:"exact_near_exit_v1"|"reconcile_value_op"};
/** The exit and native-open check/reservation share ONE short browser-wide lock. */
export function browserExitStore(account:string,contract:string,token:string,env:IntentEnvironment=browserIntentEnvironment()):IntentStore<ExitRecord> {
 return createBrowserIntentStore<ExitRecord>(`keyhole:pledge-exit:v1:${contract}:${account}:${token}`,op=>{if(op.account!==account||op.token!==token)throw Error("Exit identity mismatch");},env,{scope:pledgeLifecycleScope(account,contract),check:()=>{const pending=browserMoneyStore(account,contract,env).load();if(pending&&opensLoan(pending))throw Error("Original loan opening unresolved; do not start an exit.");}});
}
export const PLEDGE_EXIT_USDC="nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const retryableExit=(op:ExitRecord|null)=>!!op&&op.intent==="exact_near_exit_v1"&&!op.value_op_id&&["AwaitingSignature","Retryable"].includes(op.status);
/** An unsent signature is regenerable from the immutable intent. Auth is never stored in localStorage. */
export async function dispatchExitContinuation<T>(auth:SignedAuth,original:ExitRecord,store:IntentStore<ExitRecord>,preflight:()=>void,send:(auth:SignedAuth)=>Promise<T>,consumeAuth:()=>void=()=>{}):Promise<{result:T;pending:ExitRecord}> {
 if(!retryableExit(original))throw Error("Original exit may already have been dispatched; reconcile only.");
 const request=JSON.parse(auth.message),p=request.params;
 // Reject an ABA continuation BEFORE any mutation, even when every economic field is identical.
 if(!original.id||p?.intent_id!==original.id)throw Error("Signature belongs to another exit intent. Sign this saved intent again.");
 let pending=original,dispatched=false;
 try {
  if(auth.account_id!==original.account)throw Error("Exit signer changed. Sign the original intent again.");
  if(request.op!=="exact_near_exit_v1"||request.account_id!==original.account||p?.token_id!==original.token||p?.owner_epoch!==original.epoch||p?.amount!==original.amount||p?.to!==original.account||p?.chain!=="near"||p?.token!==PLEDGE_EXIT_USDC)throw Error("Signature does not match the original exit intent.");
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

export type ExitContinuation={step:"unshield"|"storage"|"withdraw";value_op_id:string;action_hash:string;original_provider_id:string|null};
/** Untrusted worker guidance cannot change the original operation or authorize a resend. */
export function exitContinuation(value:unknown,op:ExitRecord):ExitContinuation|undefined{
 if(value==null)return undefined;const v=value as ExitContinuation;
 if(!["unshield","storage","withdraw"].includes(v.step)||v.value_op_id!==op.value_op_id||!/^\d+:[a-f0-9]{64}$/.test(v.value_op_id)||v.action_hash!==v.value_op_id.split(":")[1]||(v.original_provider_id!==null&&!/^[a-f0-9-]{36}$/.test(v.original_provider_id)))throw Error("Original exit continuation binding changed.");
 return {step:v.step,value_op_id:v.value_op_id,action_hash:v.action_hash,original_provider_id:v.original_provider_id};
}
