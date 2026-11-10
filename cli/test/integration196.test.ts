import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareGuardedRequest, keyFromString, signRequest } from "../src/core.ts";
import { payout } from "../src/payout.ts";
import { readFileSync } from "node:fs";
import bs58 from "bs58";
const key=keyFromString("alice.near",bs58.encode(new Uint8Array(32).fill(1)));
const read=(epoch="7")=>(async (m:string)=>m==="nft_tokens_for_owner"?[{token_id:"k1234"}]:m==="nft_token"?{owner_id:"alice.near"}:{token_id:"k1234",owner_epoch:epoch,transfer_pending:false}) as any;
test("actual CLI/MCP prepared envelope includes string epoch and token before NEP-413 signing",async()=>{
  for(const op of ["swap","copy","withdraw","transfer","quote"]) {
    const params=await prepareGuardedRequest(key.accountId,op,{execute:true},read());
    const signed=signRequest(key,op,params,"keyhole",1000);const m=JSON.parse(signed.message);
    assert.equal(m.params.owner_epoch,"7");assert.equal(m.params.token_id,"k1234");
  }
});
test("A-B-A refuses an old explicitly supplied epoch",async()=>{await assert.rejects(prepareGuardedRequest(key.accountId,"swap",{owner_epoch:"7"},read("9")),/epoch_changed/);});
test("read operations are not forced through guarded-value admission",async()=>{const p={};assert.equal(await prepareGuardedRequest(key.accountId,"quote",p,async()=>{throw Error("must not read");}),p);});
test("Rust worker fixture is a genuine CLI signature over prepared exact params",async()=>{
  const f=JSON.parse(readFileSync(new URL("../../protocol/client-owner-epoch.json",import.meta.url),"utf8"));
  const p=await prepareGuardedRequest(key.accountId,f.op,{amount_in:"100",token_in:"USDC",token_out:"NEAR"},read());
  assert.deepEqual(JSON.parse(f.auth.message).params,p);
  const { ed25519 }=await import("@noble/curves/ed25519");const {sha256}=await import("@noble/hashes/sha256");const {nep413Bytes}=await import("../src/core.ts");
  assert.ok(ed25519.verify(Buffer.from(f.auth.signature,"base64"),sha256(nep413Bytes(f.auth.message,Buffer.from(f.auth.nonce,"base64"),"keyhole")),ed25519.getPublicKey(key.secret)));
});
const payoutRead=(registered=false,pending:any=null)=>(async(m:string)=>({payout_storage_cost:"3200000000000000000000",payout_account_registered:registered,get_payout_credit:"10",get_pending_payout:pending}[m])) as any;
test("CLI payout exact fee consent and pending cashout guard",async()=>{
  const calls:any[]=[];const execute=async(c:any)=>{calls.push(c);return {fake:true};};
  await assert.rejects(payout(key,"register",undefined,payoutRead(),execute),/Explicit consent/);assert.equal(calls.length,0);
  await payout(key,"register","3200000000000000000000",payoutRead(),execute);assert.equal(calls[0].deposit,"3200000000000000000000");
  await assert.rejects(payout(key,"claim",undefined,payoutRead(true,{nonce:"1"}),execute),/pending/);
  await payout(key,"claim",undefined,payoutRead(true),execute);assert.equal(calls[1].method,"claim_payout");assert.equal(calls[1].deposit,"1");
});

test("operator onboarding plan includes minter and exact authorized sponsorship, never signs",async()=>{
  const {payoutOnboarding}=await import("../../scripts/payout-onboarding.mjs");
  const read=async(m:string,a:any)=>m==="config"?{minter:"minter.near",treasury:"treasury.near",royalty_bps:0}:m==="payout_storage_cost"?"3200000000000000000000":m==="payout_account_registered"?a.account_id==="seller.near":m==="get_payout_credit"?"0":null;
  const plan=await payoutOnboarding(read,["seller.near"]);assert.equal(plan.status,"UNSIGNED_PLAN_NOT_EXECUTED");assert.equal(plan.items.length,2);assert.equal(plan.items[0].registration.args.account_id,"minter.near");assert.equal(plan.total_nonrefundable_storage_yocto,"3200000000000000000000");
});
