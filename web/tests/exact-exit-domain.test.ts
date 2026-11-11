import {describe,it,expect} from "vitest";
import {buildMessage} from "../lib/nep413";
import {checkBody} from "../lib/gateway";
import {exitContinuation,type ExitRecord} from "../lib/pledgeExit";
describe("exact-exit protocol fence and bounded continuation",()=>{
 it("never signs exact terms as legacy withdraw",()=>{
  expect(()=>buildMessage("withdraw","a.near",{exit_mode:"exact-near-v1"})).toThrow(/exact_near_exit_v1/);
  expect(JSON.parse(buildMessage("exact_near_exit_v1","a.near",{})).op).toBe("exact_near_exit_v1");
 });
 it("gateway refuses session and op substitution before relay",()=>{
  const message=buildMessage("exact_near_exit_v1","a.near",{});
  expect(checkBody(JSON.stringify({op:"withdraw",auth:{account_id:"a.near",public_key:"p",signature:"s",nonce:"n",recipient:"r",message}}))).toMatchObject({ok:false,code:"op_mismatch"});
  expect(checkBody(JSON.stringify({op:"exact_near_exit_v1",auth:{scheme:"session",token:"x",message,nonce:"n",recipient:"r"}}))).toMatchObject({ok:false,code:"session_scope"});
 });
 it("worker continuation guidance cannot replace immutable original journal",()=>{
  const op:ExitRecord={account:"a.near",token:"k1",epoch:"1",amount:"100",status:"Pending",value_op_id:`1:${"a".repeat(64)}`};
  const c={step:"storage",value_op_id:op.value_op_id,action_hash:"a".repeat(64),original_provider_id:"00000000-0000-4000-8000-000000000001"};
  expect(exitContinuation(c,op)).toEqual(c);
  for(const v of [{...c,value_op_id:`2:${"a".repeat(64)}`},{...c,action_hash:"b".repeat(64)},{...c,step:"all"}])expect(()=>exitContinuation(v,op)).toThrow();
 });
});
