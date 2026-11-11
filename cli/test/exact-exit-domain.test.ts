import test from "node:test";
import assert from "node:assert/strict";
import {run,signRequest,exactWithdrawParams} from "../src/core.js";
// Published 7ac5dad main.rs dispatch/auth projection: unknown op refuses before
// op_withdraw; op_withdraw authenticates(input,"withdraw",true), requiring signed
// req.op==op before constructing {chain,to,amount,token}. All network is mocked.
function publishedWithdrawal(input:any,counts:{posts:number}) {
  if(input.op!=="withdraw")return {ok:false,error:{code:"unknown_op"}};
  const req=JSON.parse(input.auth.message);
  if(req.op!=="withdraw")return {ok:false,error:{code:"op_mismatch"}};
  const {chain,to,amount,token}=req.params;
  counts.posts++;return {ok:true,body:{chain,to,amount,token}};
}
const key={accountId:"holder.near",secret:new Uint8Array(32).fill(7),publicKey:"ed25519:fixture"};
test("actual CLI direct run signs versioned exact op; old published parsing cannot send",async()=>{
 const old=globalThis.fetch, gateway=process.env.KEYHOLE_GATEWAY;process.env.KEYHOLE_GATEWAY="https://example.invalid/mock";const counts={posts:0};let signed="";
 globalThis.fetch=(async(url:any,init:any)=>{
  const input=JSON.parse(init.body);
  if(String(url).includes("example.invalid")){
   signed=JSON.parse(input.auth.message).op;
   assert.equal(input.op,"exact_near_exit_v1");
   const out=publishedWithdrawal(input,counts);assert.equal(out.error?.code,"unknown_op");
   assert.equal(publishedWithdrawal({...input,op:"withdraw"},counts).error?.code,"op_mismatch");
   return {json:async()=>({output:out})};
  }
  const method=input.params.method_name;
  const value=method==="nft_tokens_for_owner"?[{token_id:"fixture-key"}]:method==="nft_token"?{owner_id:key.accountId}:{token_id:"fixture-key",owner_epoch:"0",transfer_pending:false};
  return {ok:true,json:async()=>({result:{result:[...Buffer.from(JSON.stringify(value))]}})};
 }) as typeof fetch;
 try {const result=await run(key,"withdraw",exactWithdrawParams(key.accountId,"100"));assert.equal(result.output.ok,false);assert.equal(signed,"exact_near_exit_v1");assert.equal(counts.posts,0);}finally{globalThis.fetch=old;if(gateway===undefined)delete process.env.KEYHOLE_GATEWAY;else process.env.KEYHOLE_GATEWAY=gateway;}
});
test("low-level signer forbids exact terms under old operation",()=>{
 assert.throws(()=>signRequest(key,"withdraw",exactWithdrawParams(key.accountId,"100")),/exact_near_exit_v1/);
});
