import { describe, it, expect, vi, afterEach } from "vitest";
import { LIVE_V24_CODE_HASH, prepareGuardedRequest } from "@/lib/guardedRequest";
import { buildMessage } from "@/lib/nep413";
import { sessionAuth, sessionFromGrant, loadSession, saveSession, type Session } from "@/lib/session";
import { checkBody } from "@/lib/gateway";
import { rememberRecovery, recoveries } from "@/lib/valueRecovery";
import { readPayout, registerPayoutCall, claimPayoutCall, payoutReceiptFinal } from "@/lib/payout";
import { nearView } from "@/lib/rpc";
import { KEYS_CONTRACT } from "@/lib/config";
import { blockResponse, callFunctionResponse, FIXTURE_BLOCK_HASH, FIXTURE_BLOCK_HEIGHT, FIXTURE_BLOCK_TIMESTAMP_NS } from "./fixtures/nearRpc";
const read = (epoch="7", owner="alice.near") => vi.fn(async (m: string) => m === "nft_tokens_for_owner" ? [{token_id:"k1234"}] : m === "nft_token" ? {owner_id:owner} : {token_id:"k1234",owner_epoch:epoch,transfer_pending:false}) as any;
const session: Session = {token:"x",account:"alice.near",token_id:"k1234",owner_epoch:"7",exp_ms:999999,max_usd_micro:5000000};
const auth = (op: string, params: any) => ({account_id:"alice.near",public_key:"pk",signature:"sig",nonce:"nonce",recipient:"keyhole",message:JSON.stringify({op,account_id:"alice.near",ts_ms:1,params})});
const id = "1:"+"a".repeat(64);
function memory(): Storage { const m=new Map<string,string>();return { get length(){return m.size;}, key:i=>[...m.keys()][i]??null,getItem:k=>m.get(k)??null,setItem:(k,v)=>void m.set(k,v),removeItem:k=>void m.delete(k),clear:()=>m.clear() }; }
afterEach(()=>vi.unstubAllGlobals());
describe("signed epoch end to end",()=>{
  it.each(["swap","withdraw","copy","transfer","quote"])("binds final epoch before wallet signature: %s",async op=>{
    const p=await prepareGuardedRequest(op,"alice.near",{execute:true},undefined,read());
    const message=buildMessage(op as any,"alice.near",p,1000);
    expect(JSON.parse(message).params).toEqual({execute:true,token_id:"k1234",owner_epoch:"7"});
    if (["swap","withdraw","quote"].includes(op)) expect(checkBody(JSON.stringify({op,auth:{...auth(op,p),message}})).ok).toBe(true);
    expect(typeof JSON.parse(message).params.owner_epoch).toBe("string");
  });
  it("session signs the same epoch and refuses A-B-A title drift before using token",async()=>{
    const p=await prepareGuardedRequest("swap","alice.near",{},session,read());
    expect(JSON.parse(sessionAuth(session,"swap",p,1).message).params).toEqual(p);
    await expect(prepareGuardedRequest("swap","alice.near",{},session,read("9"))).rejects.toThrow("session_epoch");
    await expect(prepareGuardedRequest("withdraw","alice.near",{owner_epoch:"7"},undefined,read("9"))).rejects.toThrow("epoch_changed");
    await expect(prepareGuardedRequest("swap","alice.near",{},undefined,read("7","bob.near"))).rejects.toThrow("not_owner");
  });
  it("drops pre-upgrade sessions lacking a returned epoch",()=>{const st=memory();st.setItem("kh_session_v1",JSON.stringify({...session,owner_epoch:undefined}));expect(loadSession("alice.near",0,st)).toBeNull();});
  it("live v2.4 MethodNotFound keeps the legacy envelope and does not invent an epoch",async()=>{
    const missing=new Error("wasm execution failed with error: FunctionCallError(MethodResolveError(MethodNotFound))");
    const read24=vi.fn(async(m:string)=>{ if(m==="nft_tokens_for_owner") return [{token_id:"k1234"}]; if(m==="nft_token") return {owner_id:"alice.near"}; if(m==="get_control_state") throw missing; throw new Error("unexpected "+m); });
    const hash=vi.fn(async()=>LIVE_V24_CODE_HASH);
    const p=await prepareGuardedRequest("swap","alice.near",{owner_epoch:"0"},undefined,read24 as any,hash);
    expect(p).toEqual({token_id:"k1234"});
    expect(p).not.toHaveProperty("owner_epoch");
    expect(JSON.parse(buildMessage("swap","alice.near",p,1000)).params.owner_epoch).toBeUndefined();
    const grant=sessionFromGrant({ok:true,session_token:"t",account:"alice.near",token_id:"k1234",exp_ms:999999,max_usd_micro:1},"k1234","v2.4");
    expect(grant?.profile).toBe("v2.4");
    expect(grant).not.toHaveProperty("owner_epoch");
    const st=memory(); saveSession(grant!,st);
    expect(loadSession("alice.near",0,st)?.profile).toBe("v2.4");
    expect(JSON.parse(sessionAuth(grant!,"swap",{},1).message).params).toEqual({token_id:"k1234"});
  });
  it("does not treat transport, invalid signature, a bare resolver error, or an unpinned hash as v2.4",async()=>{
    const base=(err:Error)=>vi.fn(async(m:string)=>{ if(m==="nft_token") return {owner_id:"alice.near"}; if(m==="get_control_state") throw err; throw new Error(m); });
    const hash=vi.fn(async()=>LIVE_V24_CODE_HASH);
    await expect(prepareGuardedRequest("swap","alice.near",{token_id:"k1234"},undefined,base(new Error("timeout")) as any,hash)).rejects.toThrow("timeout");
    await expect(prepareGuardedRequest("swap","alice.near",{token_id:"k1234"},undefined,base(new Error("MethodResolveError(MethodInvalidSignature)")) as any,hash)).rejects.toThrow("MethodInvalidSignature");
    await expect(prepareGuardedRequest("swap","alice.near",{token_id:"k1234"},undefined,base(new Error("MethodResolveError")) as any,hash)).rejects.toThrow("MethodResolveError");
    await expect(prepareGuardedRequest("swap","alice.near",{token_id:"k1234"},undefined,base(new Error("FunctionCallError(MethodResolveError(MethodNotFound))")) as any,async()=>"not-the-live-hash")).rejects.toThrow("unpinned_contract");
    expect(hash).not.toHaveBeenCalled();
    expect(sessionFromGrant({ok:true,session_token:"t",account:"alice.near",exp_ms:1,max_usd_micro:1,owner_epoch:"0"},"k1234","v2.4")).toBeNull();
  });
});
describe("hosted custody recovery",()=>{
  it("requires signed exact journal identity and fresh holder auth",()=>{
    const a=auth("reconcile_value_op",{token_id:"k1234",value_op_id:id});
    expect(checkBody(JSON.stringify({op:"reconcile_value_op",auth:a})).ok).toBe(true);
    expect(checkBody(JSON.stringify({op:"reconcile_value_op",auth:{...a,scheme:"session",token:"x"}}))).toMatchObject({ok:false,code:"session_scope"});
    expect(checkBody(JSON.stringify({op:"reconcile_value_op",auth:auth("swap",{})}))).toMatchObject({ok:false,code:"op_mismatch"});
    expect(checkBody(JSON.stringify({op:"reconcile_value_op",auth:auth("reconcile_value_op",{token_id:"k1234",value_op_id:"other"})})).ok).toBe(false);
  });
  it("persists pending across reload/tabs; UNKNOWN never clears it; only terminal ack clears SAME journal",()=>{
    const st=memory(), a=auth("swap",{token_id:"k1234"});
    rememberRecovery(a,{value_op_id:id,status:"processing",admission_finished:false},st);
    expect(recoveries("alice.near",st)).toHaveLength(1);expect(recoveries("bob.near",st)).toHaveLength(0);
    rememberRecovery(a,{value_op_id:id,status:"needs_review",admission_finished:false},st);expect(recoveries("alice.near",st)).toHaveLength(1);
    rememberRecovery(a,{value_op_id:id,status:"success",admission_finished:false},st);expect(recoveries("alice.near",st)).toHaveLength(1);
    rememberRecovery(a,{value_op_id:id,status:"success",admission_finished:true},st);expect(recoveries("alice.near",st)).toEqual([]);
  });
  it("recovers original ID from authenticated status after a dropped transport",()=>{const st=memory();rememberRecovery(auth("status",{}),{pending_value_op:{token_id:"k1234",value_op_id:id}},st);expect(recoveries("alice.near",st)[0].value_op_id).toBe(id);});
  it("forwards only exact certificate params; rejects asset/floor injection",()=>{
    expect(checkBody(JSON.stringify({op:"loan_certificate",params:{token_id:"k1234",loan_nonce:"1"}}))).toEqual({ok:true,op:"loan_certificate",params:{token_id:"k1234",loan_nonce:"1"}});
    for(const p of [{token_id:"k1234",loan_nonce:1},{token_id:"k1234",loan_nonce:"1",asset:"fake"},{token_id:"k1234",loan_nonce:"18446744073709551616"}]) expect(checkBody(JSON.stringify({op:"loan_certificate",params:p})).ok).toBe(false);
  });
});
describe("ordinary-flow payout onboarding",()=>{
  const reader=(registered=false,pending:any=null)=>vi.fn(async(m:string)=>({payout_storage_cost:"3200000000000000000000",payout_account_registered:registered,get_payout_credit:"10",get_pending_payout:pending}[m])) as any;
  it("requires exact explicit fee; duplicate slot cannot be silently recharged",async()=>{const s=await readPayout("alice.near",reader());expect(()=>registerPayoutCall(s,"0")).toThrow();expect(registerPayoutCall(s,"3200000000000000000000").deposit).toBe("3200000000000000000000");expect(()=>registerPayoutCall({...s,registered:true} as any,"3200000000000000000000")).toThrow();});
  it("claims only available registered credit and refuses a pending UNKNOWN payout",async()=>{expect(claimPayoutCall(await readPayout("alice.near",reader(true))).method).toBe("claim_payout");expect(()=>claimPayoutCall({supported:true,registered:true,cost:"1",credit:"5",pending:{nonce:"1",amount:"10"}})).toThrow();});
  it("v2.4 detection requires MethodNotFound, never a sibling resolver or transport error",async()=>{
    expect(await readPayout("alice.near",vi.fn().mockRejectedValue(new Error("wasm execution failed with error: FunctionCallError(MethodResolveError(MethodNotFound))")) as any)).toEqual({supported:false});
    for (const message of ["MethodResolveError(MethodInvalidSignature)","MethodResolveError","method not found","timeout","fetch failed"]) {
      await expect(readPayout("alice.near",vi.fn().mockRejectedValue(new Error(message)) as any)).rejects.toThrow(message);
    }
    await expect(readPayout("alice.near",vi.fn(async()=>"not-digits") as any)).rejects.toThrow("Invalid payout state");
  });
  it("reads payout state from a call_function body that names its block", async () => {
    const header = blockResponse().result.header;
    expect(header.hash).toBe(FIXTURE_BLOCK_HASH);
    expect(header.height).toBe(FIXTURE_BLOCK_HEIGHT);
    expect(header.timestamp_nanosec).toBe(FIXTURE_BLOCK_TIMESTAMP_NS);
    expect(typeof header.timestamp).toBe("number");
    const values: Record<string, unknown> = { payout_storage_cost: "3200000000000000000000", payout_account_registered: false, get_payout_credit: "0", get_pending_payout: null };
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const j = JSON.parse(String(init?.body));
      if (j.method === "block") return Response.json(blockResponse());
      const shaped = callFunctionResponse(values[j.params.method_name]);
      expect(shaped.result.block_hash).toBe(header.hash);
      expect(shaped.result.block_height).toBe(header.height);
      return Response.json(shaped);
    }));
    await expect(nearView("payout_storage_cost", {}, KEYS_CONTRACT, { shared: false })).resolves.toBe("3200000000000000000000");
    const state = await readPayout("alice.near");
    expect(state).toEqual({ supported: true, registered: false, cost: "3200000000000000000000", credit: "0", pending: null });
  });
  it("does not label wallet hash, optimistic status or callback failure as cash delivered",()=>{
    const j={final_execution_status:"FINAL",transaction:{signer_id:"alice.near",receiver_id:KEYS_CONTRACT,actions:[{FunctionCall:{method_name:"claim_payout"}}]},status:{SuccessValue:"dHJ1ZQ=="},receipts_outcome:[{outcome:{status:{SuccessValue:""}}},{outcome:{status:{SuccessValue:"dHJ1ZQ=="}}}]};
    expect(payoutReceiptFinal(j,"alice.near")).toBe(true);
    expect(payoutReceiptFinal({...j,final_execution_status:"EXECUTED_OPTIMISTIC"},"alice.near")).toBe(false);
    expect(payoutReceiptFinal({...j,status:{SuccessValue:"ZmFsc2U="}},"alice.near")).toBe(false);
    expect(payoutReceiptFinal(j,"bob.near")).toBe(false);
  });
});

describe("real hosted gateway adapter",()=>{
  it("relays the same authenticated journal on pending and terminal responses, and preserves public certificate params",async()=>{
    const { POST }=await import("@/app/api/worker/route");const { NextRequest }=await import("next/server");
    const prior=process.env.OUTLAYER_PAYMENT_KEY;process.env.OUTLAYER_PAYMENT_KEY="local-test-not-a-secret";
    const sent:any[]=[];
    vi.stubGlobal("fetch",vi.fn(async(_url:any,opts:any)=>{
      // The gateway starts the call (async) and polls /calls/{id}. The start
      // returns pending (no output); the poll returns the terminal output.
      if(String(_url).includes("/calls/")) return new Response(JSON.stringify({call_id:"local-test",status:"completed",output:{ok:true,value_op_id:id,status:"success",admission_finished:true}}),{headers:{"content-type":"application/json"}});
      const body=JSON.parse(opts.body);sent.push(body.input);return new Response(JSON.stringify({call_id:"local-test",status:"pending"}),{headers:{"content-type":"application/json"}});}));

    try {
      const a=auth("reconcile_value_op",{token_id:"k1234",value_op_id:id});
      for(let i=0;i<2;i++) {const response=await POST(new NextRequest("http://localhost/api/worker",{method:"POST",headers:{"x-forwarded-for":"192.0.2.196"},body:JSON.stringify({op:"reconcile_value_op",auth:a})}));expect(response.status).toBe(200);expect(sent[i]).toEqual({op:"reconcile_value_op",auth:a});}
      const response=await POST(new NextRequest("http://localhost/api/worker",{method:"POST",headers:{"x-forwarded-for":"192.0.2.197"},body:JSON.stringify({op:"loan_certificate",params:{token_id:"k1234",loan_nonce:"7"}})}));
      expect(response.status).toBe(200);expect(sent[2]).toEqual({op:"loan_certificate",params:{token_id:"k1234",loan_nonce:"7"}});
    } finally {if(prior===undefined)delete process.env.OUTLAYER_PAYMENT_KEY;else process.env.OUTLAYER_PAYMENT_KEY=prior;}
  });
});

it("stale readonly sessions require re-unlock instead of looping on a cached grant",async()=>{
  const st=memory();st.setItem("kh_session_v1",JSON.stringify(session));vi.stubGlobal("sessionStorage",st);vi.stubGlobal("window",{dispatchEvent:vi.fn()});
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({output:{ok:false,error:{code:"session_epoch"}}}),{headers:{"content-type":"application/json"}})));
  const {callWorker}=await import("@/lib/worker");await callWorker("status",sessionAuth(session,"status",{},1) as any);expect(st.getItem("kh_session_v1")).toBeNull();
});

// Promoting identity to v2.5 must not silently promote the legacy MethodNotFound exception.
it("keeps the legacy exception pinned to v2.4, never the upgraded identity", () => {
  expect(LIVE_V24_CODE_HASH).toBe("DEXHHyEMdFTdFQ32dYnj264RSj3QG2FSwCY5fbjzSiZZ");
  expect(LIVE_V24_CODE_HASH).not.toBe("3kFeCRQMfBweSDsL72DrggEeJJ6v9DLw2xSn7T6zqK3b");
});
