import {afterEach,describe,it,expect,vi} from "vitest";
import {createBrowserIntentStore,type IntentEnvironment} from "@/lib/pledgeIntentStore";
import {browserMoneyStore,dispatchMoneyBatch,clearMoneyOperation,updateMoneyOperation,type MoneyOperation} from "@/lib/pledgeMoney";
import {dispatchExitContinuation,retryableExit,PLEDGE_EXIT_USDC,type ExitRecord} from "@/lib/pledgeExit";
import {createPledgeReadGate} from "@/lib/pledgeSafety";
import {abortable,createSingleFlightRefresh,startPledgePolling} from "@/lib/pledgeRefresh";
import {sendRoutedKeysCalls,sendKeysCalls,type TxRoute} from "@/lib/keysTx";
import type {SignedAuth} from "@/lib/nep413";
class MemoryStorage implements Storage {
 private data=new Map<string,string>();get length(){return this.data.size;}clear(){this.data.clear();}key(i:number){return [...this.data.keys()][i]??null;}getItem(key:string){return this.data.get(key)??null;}setItem(key:string,value:string){this.data.set(key,value);}removeItem(key:string){this.data.delete(key);}
}
function tabs(){
 const storage=new MemoryStorage(),listeners=new Set<()=>void>();let id=0,queue=Promise.resolve();
 const locks={request<T>(_name:string,job:()=>T|Promise<T>):Promise<T>{const run=queue.then(job);queue=run.then(()=>{},()=>{});return run;}};
 const env=(session=new MemoryStorage()):IntentEnvironment=>({storage,session,locks,uuid:()=>`intent-${++id}`,listen:fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},changed:()=>listeners.forEach(fn=>fn())});
 return {storage,env};
}
const call={method:"claim_payout",args:{},deposit:"1",gas:"200000000000000"};
const exit:ExitRecord={account:"alice.near",token:"k1",epoch:"1",amount:"100",status:"AwaitingSignature",intent:"withdraw"};
const auth={account_id:"alice.near",signature:"signature",message:JSON.stringify({op:"withdraw",account_id:exit.account,params:{token_id:exit.token,owner_epoch:exit.epoch,amount:exit.amount,to:exit.account,chain:"near",token:PLEDGE_EXIT_USDC}})} as SignedAuth;
afterEach(()=>vi.useRealTimers());
describe("H194-R3-01 unsent exit recovery",()=>{
 it.each(["popup","redirect"])("%s failure survives reload and permits regeneration without dispatch",async kind=>{
  const {env}=tabs(),tab=env(),make=()=>createBrowserIntentStore<ExitRecord>("exit",()=>{},tab),store=make(),original=await store.reserve(exit),gate=createPledgeReadGate(()=>100),send=vi.fn(async()=>({ok:true})),consume=vi.fn(()=>expect(store.load()?.status).toBe("Retryable"));
  await expect(dispatchExitContinuation(auth,original,store,()=>gate.capture("alice|k1"),send,kind==="redirect"?consume:undefined)).rejects.toThrow("stale");
  expect(send).not.toHaveBeenCalled();expect(consume).toHaveBeenCalledTimes(kind==="redirect"?1:0);
  const reloaded=make(),saved=reloaded.load()!;expect(saved.status).toBe("Retryable");expect(retryableExit(saved)).toBe(true);expect(saved.value_op_id).toBeUndefined();
  gate.complete(gate.begin("alice|k1"));await dispatchExitContinuation({...auth,signature:"regenerated"},saved,reloaded,()=>gate.capture("alice|k1"),send);expect(send).toHaveBeenCalledOnce();expect(reloaded.load()?.status).toBe("UNKNOWN");
 });
 it("rechecks after storage awaits, preserving regeneration before consuming redirect auth",async()=>{
  const {env}=tabs(),store=createBrowserIntentStore<ExitRecord>("exit",()=>{},env()),saved=await store.reserve(exit),send=vi.fn();let checks=0;const consume=vi.fn(()=>expect(store.load()?.status).toBe("Retryable"));
  await expect(dispatchExitContinuation(auth,saved,store,()=>{if(++checks===2)throw Error("refresh started");},send,consume)).rejects.toThrow("refresh started");expect(send).not.toHaveBeenCalled();expect(consume).toHaveBeenCalledOnce();
 });
 it("storage failure neither consumes auth nor sends",async()=>{
  const {env}=tabs(),store=createBrowserIntentStore<ExitRecord>("exit",()=>{},env()),saved=await store.reserve(exit),send=vi.fn(),consume=vi.fn();await expect(dispatchExitContinuation(auth,saved,{...store,replace:async()=>{throw Error("disk");}},()=>{},send,consume)).rejects.toThrow("disk");expect(consume).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();expect(store.load()?.status).toBe("AwaitingSignature");
 });
 it("an uncertain dispatched worker result is never retryable",async()=>{
  const {env}=tabs(),store=createBrowserIntentStore<ExitRecord>("exit",()=>{},env()),saved=await store.reserve(exit),send=vi.fn(async()=>{expect(store.load()?.status).toBe("UNKNOWN");throw Error("timeout after dispatch");});await expect(dispatchExitContinuation(auth,saved,store,()=>{},send)).rejects.toThrow("timeout");expect(retryableExit(store.load())).toBe(false);await expect(dispatchExitContinuation(auth,store.load()!,store,()=>{},send)).rejects.toThrow("reconcile");expect(send).toHaveBeenCalledOnce();
 });
 it.each(["amount","owner_epoch","token_id","to","token","chain"])("rejects changed signed %s",async field=>{const {env}=tabs(),store=createBrowserIntentStore<ExitRecord>("exit",()=>{},env()),saved=await store.reserve(exit),send=vi.fn(),request=JSON.parse(auth.message);request.params[field]="different";await expect(dispatchExitContinuation({...auth,message:JSON.stringify(request)},saved,store,()=>{},send)).rejects.toThrow("original exit intent");expect(send).not.toHaveBeenCalled();expect(retryableExit(store.load())).toBe(true);});
 it("discarding an unsent X cannot let its late signature dispatch or erase replacement Y",async()=>{const {env}=tabs(),store=createBrowserIntentStore<ExitRecord>("exit",()=>{},env()),x=await store.reserve(exit);expect(await store.clear(x)).toBe(true);const y=await store.reserve({...exit,amount:"200"}),send=vi.fn();await expect(dispatchExitContinuation(auth,x,store,()=>{},send)).rejects.toThrow("intent changed");expect(send).not.toHaveBeenCalled();expect(store.load()).toEqual(y);});
 it("a different signer aborts locally",async()=>{
  const {env}=tabs(),store=createBrowserIntentStore<ExitRecord>("exit",()=>{},env()),saved=await store.reserve(exit),send=vi.fn();await expect(dispatchExitContinuation({...auth,account_id:"bob.near"},saved,store,()=>{},send)).rejects.toThrow("signer changed");expect(send).not.toHaveBeenCalled();expect(store.load()?.status).toBe("Retryable");
 });
});
describe("M194-R3-02 per-intent cross-tab ownership",()=>{
 it("delayed FINAL X cannot erase Y, including reload while Y awaits its wallet",async()=>{
  const {env}=tabs(),tabA=env(),a=browserMoneyStore("alice.near","keys.near",tabA),b=browserMoneyStore("alice.near","keys.near",env());await dispatchMoneyBatch("alice.near","keys.near",[call],a,async()=>({txHash:"X"}),"42");const x=a.load()!,capturedB=b.load()!;expect(await clearMoneyOperation(a,x)).toBe(true);
  let resolve!:()=>void;const waiting=new Promise<void>(r=>{resolve=r;}),y=dispatchMoneyBatch("alice.near","keys.near",[call],a,async()=>{await waiting;return {redirect:true};},"43");await vi.waitFor(()=>expect(a.load()?.status).toBe("AwaitingWallet"));expect(await clearMoneyOperation(b,capturedB)).toBe(false);expect(await clearMoneyOperation(a,x)).toBe(false);
  const reloaded=browserMoneyStore("alice.near","keys.near",tabA);expect(reloaded.load()).toMatchObject({status:"AwaitingWallet",minBlockHeight:"43"});expect(reloaded.load()?.id).not.toBe(x.id);resolve();await y;expect(reloaded.load()?.status).toBe("AwaitingWallet");
 });
 it("simultaneous tabs open exactly one wallet and publish its reservation",async()=>{
  const {env}=tabs(),a=browserMoneyStore("alice.near","keys.near",env()),b=browserMoneyStore("alice.near","keys.near",env()),send=vi.fn(async()=>({redirect:true as const})),observed=vi.fn(()=>expect(b.load()).not.toBeNull());b.subscribe!(observed);
  const results=await Promise.allSettled([a,b].map(store=>dispatchMoneyBatch("alice.near","keys.near",[call],store,send,"42")));expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(send).toHaveBeenCalledOnce();expect(observed).toHaveBeenCalled();
 });
 it("another owner cannot attach a hash, replace or clear a current record",async()=>{
  const {env}=tabs(),a=browserMoneyStore("alice.near","keys.near",env()),b=browserMoneyStore("alice.near","keys.near",env());await dispatchMoneyBatch("alice.near","keys.near",[call],a,async()=>({redirect:true}),"42");const original=b.load()!;expect(await updateMoneyOperation(b,original,{...original,txHash:"forged"})).toBe(false);expect(await clearMoneyOperation(b,original)).toBe(false);expect(a.load()).toEqual(original);
  expect(await updateMoneyOperation(a,original,{...original,txHash:"original",status:"Submitted"})).toBe(true);expect(await clearMoneyOperation(a,original)).toBe(false);expect(a.load()?.txHash).toBe("original");
 });
 it("without Web Locks dispatch fails closed",async()=>{
  const {env}=tabs(),environment=env();environment.locks=undefined;const store=browserMoneyStore("alice.near","keys.near",environment),send=vi.fn();await expect(dispatchMoneyBatch("alice.near","keys.near",[call],store,send,"42")).rejects.toThrow("Web Locks");expect(send).not.toHaveBeenCalled();
 });
 it("legacy records stay unresolved until identity-checked recovery",async()=>{
  const {env,storage}=tabs(),store=browserMoneyStore("alice.near","keys.near",env()),legacy:MoneyOperation={account:"alice.near",contract:"keys.near",call,status:"UNKNOWN",minBlockHeight:"42"};storage.setItem("keyhole:pledge-money:v1:keys.near:alice.near",JSON.stringify(legacy));await expect(dispatchMoneyBatch("alice.near","keys.near",[call],store,vi.fn(),"43")).rejects.toThrow("unresolved");expect(await updateMoneyOperation(store,legacy,{...legacy,txHash:"original"})).toBe(true);expect(store.load()?.id).toBeTruthy();expect(await clearMoneyOperation(store,legacy)).toBe(false);
 });
});
describe("M194-R3-03 backpressure and L194-R3-05 read age",()=>{
 it("sustained eight-second reads publish; polls and manual refresh cannot supersede them",async()=>{
  vi.useFakeTimers();const runner=createSingleFlightRefresh(),gate=createPledgeReadGate(()=>Date.now()),starts:number[]=[],success:number[]=[];
  const refresh=()=>runner.run(async signal=>{starts.push(Date.now());const ticket=gate.begin("a");await abortable(new Promise<void>(r=>setTimeout(r,8000)),signal);gate.complete(ticket);success.push(Date.now());});const stop=startPledgePolling(refresh,()=>true);await vi.advanceTimersByTimeAsync(4000);const manual=refresh();expect(starts).toHaveLength(1);await vi.advanceTimersByTimeAsync(4000);await manual;expect(()=>gate.capture("a")).not.toThrow();await vi.advanceTimersByTimeAsync(24000);stop();expect(starts).toHaveLength(3);expect(success).toHaveLength(3);expect(()=>gate.capture("a")).not.toThrow();
 });
 it("timeout releases single-flight; late responses cannot publish over a later success",async()=>{
  vi.useFakeTimers();const runner=createSingleFlightRefresh(1000),gate=createPledgeReadGate(()=>Date.now()),published=vi.fn();let resolve!:()=>void;
  const first=runner.run(async signal=>{const ticket=gate.begin("a");try{await abortable(new Promise<void>(r=>{resolve=r;}),signal);gate.complete(ticket);published();}catch(e){gate.fail(ticket);throw e;}}),failed=expect(first).rejects.toThrow("timed out");await vi.advanceTimersByTimeAsync(1000);await failed;expect(()=>gate.capture("a")).toThrow();await runner.run(async()=>{gate.complete(gate.begin("a"));published();});resolve();await vi.advanceTimersByTimeAsync(1);expect(published).toHaveBeenCalledOnce();expect(()=>gate.capture("a")).not.toThrow();
 });
 it("errors back off to a bound and successful reads restore normal polling",async()=>{
  vi.useFakeTimers();const starts:number[]=[],refresh=vi.fn(async()=>{starts.push(Date.now());if(starts.length<3)throw Error("RPC");}),stop=startPledgePolling(refresh,()=>true,4000,10000);await vi.advanceTimersByTimeAsync(22000);stop();expect(starts.map(t=>t-starts[0])).toEqual([0,8000,18000,22000]);
 });
 it("an early owner/clock read cannot become fresh after a much later receipt",async()=>{
  let now=0;const gate=createPledgeReadGate(()=>now),ticket=gate.begin("a");now=500;await Promise.resolve("early owner");now=11000;await Promise.resolve("late receipt");expect(()=>gate.complete(ticket)).toThrow("observation window");expect(()=>gate.capture("a")).toThrow();
 });
 it("nine-second successful reads keep only the remaining request-start lease",()=>{
  let now=0;const gate=createPledgeReadGate(()=>now),ticket=gate.begin("a");now=9000;expect(gate.complete(ticket)).toBe(true);expect(gate.capture("a").readAt).toBe(0);now=10001;expect(()=>gate.capture("a")).toThrow();
 });
});
describe("M194-R3-04 signer-bound routing",()=>{
 it("switching accounts while routing is delayed never invokes the wallet",async()=>{
  let resolve!:(route:TxRoute)=>void;const wallet={signAndSendTransaction:vi.fn()},routing=new Promise<TxRoute>(r=>{resolve=r;}),result=sendRoutedKeysCalls(()=>routing,[call],{expectedSigner:"alice.near"});resolve({kind:"nc",accountId:"bob.near",wallet});expect(await result).toMatchObject({error:{code:"bad_call",preSend:true}});expect(wallet.signAndSendTransaction).not.toHaveBeenCalled();
 });
 it("live route and consent/read checks run immediately before signing",async()=>{
  const wallet={signAndSendTransaction:vi.fn()};for(const field of ["route","consent"]){const bad=()=>{throw Error("changed");},result=await sendRoutedKeysCalls(async()=>({kind:"nc",accountId:"alice.near",wallet,assertCurrent:field==="route"?bad:undefined}),[call],{expectedSigner:"alice.near",assertCurrent:field==="consent"?bad:undefined});expect(result).toMatchObject({error:{preSend:true}});}expect(wallet.signAndSendTransaction).not.toHaveBeenCalled();
 });
 it.each(["bob.near",undefined])("returned signer %s is not consent-matched success or an unsent failure",async signer=>{
  const wallet={signAndSendTransaction:vi.fn(async()=>({transaction:{hash:"original",signer_id:signer}}))},result=await sendKeysCalls({kind:"nc",accountId:"alice.near",wallet},[call],"keys.near",{expectedSigner:"alice.near"});expect(result).toMatchObject({error:{code:"unknown"}});expect("error" in result&&result.error.preSend).toBeUndefined();expect(wallet.signAndSendTransaction).toHaveBeenCalledOnce();
 });
 it("matching signers succeed; redirects still need later FINAL reconciliation",async()=>{
  for(const response of [{transaction:{hash:"original",signer_id:"alice.near"}},undefined]){const wallet={signAndSendTransaction:vi.fn(async()=>response)};expect(await sendKeysCalls({kind:"nc",accountId:"alice.near",wallet},[call],"keys.near",{expectedSigner:"alice.near"})).toEqual(response?{txHash:"original"}:{redirect:true});}
 });
});

it("an already-aborted wait still observes a later transport rejection",async()=>{const controller=new AbortController();controller.abort(Error("deadline"));let reject!:(e:Error)=>void;const transport=new Promise<void>((_,r)=>{reject=r;});await expect(abortable(transport,controller.signal)).rejects.toThrow("deadline");reject(Error("late transport"));await Promise.resolve();});
it("a mismatched returned signer retains its hash as UNKNOWN and blocks another wallet request",async()=>{const {env}=tabs(),store=browserMoneyStore("alice.near","keys.near",env()),wallet={signAndSendTransaction:vi.fn(async()=>({transaction:{hash:"wrong-signer",signer_id:"bob.near"}}))};const send=()=>sendKeysCalls({kind:"nc",accountId:"alice.near",wallet},[call],"keys.near",{expectedSigner:"alice.near"});await dispatchMoneyBatch("alice.near","keys.near",[call],store,send,"42");expect(store.load()).toMatchObject({status:"UNKNOWN",txHash:"wrong-signer"});await expect(dispatchMoneyBatch("alice.near","keys.near",[call],store,send,"42")).rejects.toThrow("unresolved");expect(wallet.signAndSendTransaction).toHaveBeenCalledOnce();});
