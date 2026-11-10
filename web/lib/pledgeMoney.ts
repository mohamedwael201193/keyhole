import type {KeysCall,BatchSendResult} from "./keysTx";
import {createBrowserIntentStore,browserIntentEnvironment,type IntentStore,type IntentEnvironment} from "./pledgeIntentStore";
export type MoneyOperation={id?:string;owner?:string;account:string;contract:string;call:KeysCall;calls?:KeysCall[];error?:string;status:"AwaitingWallet"|"Submitted"|"UNKNOWN";minBlockHeight:string;txHash?:string};
export type MoneyStore={load():MoneyOperation|null;save(op:MoneyOperation|null):void}&Partial<Omit<IntentStore<MoneyOperation>,"load">>;
export function browserMoneyStore(account:string,contract:string,env:IntentEnvironment=browserIntentEnvironment()):MoneyStore {
 const store=createBrowserIntentStore<MoneyOperation>(`keyhole:pledge-money:v1:${contract}:${account}`,op=>{if(op.account!==account||op.contract!==contract)throw Error("Pending operation identity mismatch");},env);
 return {...store,save(){throw Error("Use identity-checked money operation mutations");}};
}
/** Only identity-matched updates/removals are allowed after an async boundary. */
export async function updateMoneyOperation(store:MoneyStore,expected:MoneyOperation,next:MoneyOperation):Promise<boolean>{
 if(store.replace)return store.replace(expected,next);
 if(JSON.stringify(store.load())!==JSON.stringify(expected))return false;store.save(next);return true;
}
export async function clearMoneyOperation(store:MoneyStore,expected:MoneyOperation):Promise<boolean>{
 if(store.clear)return store.clear(expected);
 if(JSON.stringify(store.load())!==JSON.stringify(expected))return false;store.save(null);return true;
}
/** Persist BEFORE opening a wallet or following its redirect. No automatic retry on network/receipt uncertainty. */
export async function dispatchMoney(account:string,contract:string,call:KeysCall,store:MoneyStore,send:(call:KeysCall)=>Promise<BatchSendResult>,minBlockHeight:string,calls?:KeysCall[]):Promise<MoneyOperation|null> {
 if(store.load())throw Error("An earlier money operation is unresolved. Refresh its original receipt; do not resend.");
 if(!/^\d+$/.test(minBlockHeight)||BigInt(minBlockHeight)<=0n)throw Error("Final chain dispatch anchor unavailable");
 let op:MoneyOperation={account,contract,call,status:"AwaitingWallet",minBlockHeight,...(calls?{calls}: {})};if(store.reserve)op=await store.reserve(op);else store.save(op);
 try {
  const result=await send(call);const previous={...op};
  if("txHash" in result&&typeof result.txHash==="string"){op.txHash=result.txHash;op.status="error" in result&&result.error.code==="unknown"?"UNKNOWN":"Submitted";if("error" in result)op.error=result.error.message;}
  else if("redirect" in result){op.status="AwaitingWallet";}
  else if("error" in result&&result.error.preSend===true&&["signed_out","unsupported_wallet","bad_call"].includes(result.error.code)){await clearMoneyOperation(store,previous);throw Error(result.error.message);}
  else {op.status="UNKNOWN";if("error" in result)op.error=result.error.message;}
  await updateMoneyOperation(store,previous,op);return op;
 }catch(error){const saved=store.load();if(saved&&(saved.id? saved.id===op.id:JSON.stringify(saved)===JSON.stringify(op))){await updateMoneyOperation(store,saved,{...op,status:"UNKNOWN"});}throw error;}
}
/** Persist every ordered action before the single wallet request, including first-use storage. */
export async function dispatchMoneyBatch(account:string,contract:string,calls:readonly KeysCall[],store:MoneyStore,send:(calls:readonly KeysCall[])=>Promise<BatchSendResult>,minBlockHeight:string):Promise<MoneyOperation|null> {
 if(!calls.length||calls.length>10)throw Error("Expected an atomic money-action batch");
 const snapshot=JSON.parse(JSON.stringify(calls)) as KeysCall[];
 return dispatchMoney(account,contract,snapshot[snapshot.length-1],store,()=>send(JSON.parse(JSON.stringify(snapshot))),minBlockHeight,snapshot);
}
function stable(value:unknown):string {
 if(Array.isArray(value))return `[${value.map(stable).join(",")}]`;
 if(value&&typeof value==="object")return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
 return JSON.stringify(value);
}
/** Binds the finalized transaction to the persisted sender/contract/call; URL hashes are never trusted alone. */
export function matchesMoneyReceipt(op:MoneyOperation,result:unknown):boolean {
 try {
  const r=result as {final_execution_status?:string;transaction?:{hash?:string;signer_id?:string;receiver_id?:string;actions?:{FunctionCall?:{method_name?:string;deposit?:string;gas?:number|string;args?:string}}[]}};
  const tx=r.transaction,actions=tx?.actions;
  if(r.final_execution_status!=="FINAL"||!tx||tx.hash!==op.txHash||tx.signer_id!==op.account||tx.receiver_id!==op.contract||!actions)return false;
  const expected=op.calls??[op.call];
  if(actions.length!==expected.length)return false;
  return expected.every((want,i)=>{
   const call=actions[i].FunctionCall;
   if(!call||call.method_name!==want.method||call.deposit!==want.deposit||String(call.gas)!==want.gas||typeof call.args!=="string")return false;
   const json=new TextDecoder().decode(Uint8Array.from(atob(call.args),x=>x.charCodeAt(0)));
   return stable(JSON.parse(json))===stable(want.args);
  });
 }catch{return false;}
}
export async function finalMoneyReceipt(op:MoneyOperation,rpcUrl:string,signal?:AbortSignal):Promise<boolean> {
 if(!op.txHash)return false;
 const response=await fetch(rpcUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:"pledge-receipt",method:"tx",params:{tx_hash:op.txHash,sender_account_id:op.account,wait_until:"FINAL"}}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20_000)]):AbortSignal.timeout(20_000)});
 const json=await response.json();if(!response.ok||json.error||!matchesMoneyReceipt(op,json.result))return false;
 // Reject a replayed older same-method transaction hash from a forged redirect URL.
 const blockHash=json.result?.transaction_outcome?.block_hash;if(typeof blockHash!=="string"||!/^\d+$/.test(op.minBlockHeight))return false;
 const block=await fetch(rpcUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:"pledge-receipt-block",method:"block",params:{block_id:blockHash}}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20_000)]):AbortSignal.timeout(20_000)});
 const header=(await block.json()).result?.header;
 return block.ok&&header?.hash===blockHash&&Number.isSafeInteger(header.height)&&BigInt(header.height)>=BigInt(op.minBlockHeight);
}

export async function nextFinalBlockHeight(rpcUrl:string,signal?:AbortSignal):Promise<string>{
 const response=await fetch(rpcUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:"pledge-dispatch-anchor",method:"block",params:{finality:"final"}}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20_000)]):AbortSignal.timeout(20_000)});
 const j=await response.json(),height=j.result?.header?.height;
 if(!response.ok||j.error||!Number.isSafeInteger(height)||height<0)throw Error("Final dispatch block unavailable");
 return (BigInt(height)+1n).toString();
}
