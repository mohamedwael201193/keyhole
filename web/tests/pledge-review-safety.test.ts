import {describe,it,expect,vi} from "vitest";
import {readFileSync} from "node:fs";
import {assertStorageConsent,storageConsentMatches,createPledgeReadGate} from "@/lib/pledgeSafety";
import {dispatchMoney,type MoneyOperation,type MoneyStore} from "@/lib/pledgeMoney";
import {sendKeysCalls,type TxErrorCode,type TxWallet} from "@/lib/keysTx";
const call={method:"claim_payout",args:{},deposit:"1",gas:"200000000000000"};
function memory():MoneyStore {let value:MoneyOperation|null=null;return {load:()=>value,save:x=>{value=x;}};}
describe("M194-01 wallet result provenance",()=>{
 it.each(["AbortError: aborted after broadcast","user canceled after submission","closed the popup after submit"])("keeps UNKNOWN for %s",async text=>{
  const store=memory(),wallet:TxWallet={signAndSendTransaction:vi.fn(async()=>{throw Error(text);})};
  const send=()=>sendKeysCalls({kind:"nc",accountId:"alice.near",wallet},[call]);
  await dispatchMoney("alice.near","keys.near",call,store,send,"42");
  expect(store.load()).toMatchObject({status:"UNKNOWN",account:"alice.near",contract:"keys.near",call});
  await expect(dispatchMoney("alice.near","keys.near",call,store,send,"42")).rejects.toThrow("unresolved");
  expect(wallet.signAndSendTransaction).toHaveBeenCalledTimes(1);
 });
 it.each(["signed_out","unsupported_wallet","bad_call"] as TxErrorCode[])("unmarked %s is not proof of non-submission",async code=>{const store=memory();await dispatchMoney("alice.near","keys.near",call,store,async()=>({error:{code,message:"ambiguous"}}),"42");expect(store.load()?.status).toBe("UNKNOWN");});
 it("only explicit local validation clears the operation, without invoking the wallet",async()=>{
  const store=memory(),wallet:TxWallet={signAndSendTransaction:vi.fn()};
  await expect(dispatchMoney("alice.near","keys.near",call,store,()=>sendKeysCalls({kind:"nc",accountId:"alice.near",wallet},[{...call,deposit:"invalid"}]),"42")).rejects.toThrow("deposit");
  expect(store.load()).toBeNull();expect(wallet.signAndSendTransaction).not.toHaveBeenCalled();
 });
 it("a thrown post-submit abort keeps the saved UNKNOWN intent",async()=>{const store=memory();await expect(dispatchMoney("alice.near","keys.near",call,store,async()=>{throw Error("AbortError");},"42")).rejects.toThrow("AbortError");expect(store.load()?.status).toBe("UNKNOWN");});
});
describe("M194-02 exact storage consent",()=>{
 const consent={account:"alice.near",contract:"keys.near",fee:"3200000000000000000000"};
 it("accepts only the identity and quote displayed to the signer",()=>{expect(storageConsentMatches(consent,"alice.near","keys.near",consent.fee)).toBe(true);expect(()=>assertStorageConsent(consent,"alice.near","keys.near",consent.fee,consent.fee)).not.toThrow();});
 it.each([["bob.near","keys.near","3200000000000000000000"],["alice.near","other.near","3200000000000000000000"],["alice.near","keys.near","3300000000000000000000"],["alice.near","keys.near",null]] as const)("rejects changed account/contract/quote %s %s %s",(account,contract,fee)=>{expect(storageConsentMatches(consent,account,contract,fee)).toBe(false);expect(()=>assertStorageConsent(consent,account,contract,fee,consent.fee)).toThrow("Storage fee changed");});
 it("rechecks the newly prepared charge, even when the checkbox still looks acknowledged",()=>{expect(()=>assertStorageConsent(consent,consent.account,consent.contract,consent.fee,"3300000000000000000000")).toThrow();expect(()=>assertStorageConsent(null,consent.account,consent.contract,consent.fee,consent.fee)).toThrow();});
 it("zero-fee registration cannot hide a newly chargeable plan",()=>{expect(()=>assertStorageConsent(null,consent.account,consent.contract,"0","0")).not.toThrow();expect(()=>assertStorageConsent(consent,consent.account,consent.contract,"0",consent.fee)).toThrow();});
 it("the shared borrower/lender UI clears acknowledgement on every quote/identity transition",()=>{const source=readFileSync(new URL("../app/pledge/LivePledge.tsx",import.meta.url),"utf8");expect(source).toContain('consentRef.current=null;setConsent(null);feeRef.current=fee;},[account,client.contractId,fee]');expect(source).toContain('assertStorageConsent(consentRef.current,account,client.contractId,feeRef.current,plan.payoutStorageChargeYocto)');});
});
describe("M194-03 refresh revokes dispatch",()=>{
 it("a manual or polled refresh immediately blocks executable stale state",()=>{const gate=createPledgeReadGate(()=>100);gate.complete(gate.begin("alice|k1"));const lease=gate.capture("alice|k1"),pending=gate.begin("alice|k1");expect(()=>gate.capture("alice|k1")).toThrow();expect(()=>gate.assert(lease,"alice|k1")).toThrow();gate.fail(pending);expect(()=>gate.capture("alice|k1")).toThrow();});
 it("failed refresh during awaited preflight never reaches wallet dispatch",async()=>{const gate=createPledgeReadGate(()=>100),send=vi.fn();gate.complete(gate.begin("alice|k1"));const lease=gate.capture("alice|k1");const preflight=async()=>{await Promise.resolve();gate.fail(gate.begin("alice|k1"));};await preflight();expect(()=>{gate.assert(lease,"alice|k1");send();}).toThrow();expect(send).not.toHaveBeenCalled();});
 it("old successes and failures cannot overwrite the newest request",()=>{const gate=createPledgeReadGate(()=>100),older=gate.begin("alice|k1"),newer=gate.begin("alice|k1");expect(gate.complete(newer)).toBe(true);expect(gate.complete(older)).toBe(false);expect(gate.fail(older)).toBe(false);expect(()=>gate.capture("alice|k1")).not.toThrow();});
 it("account/token changes and elapsed freshness invalidate captured dispatches",()=>{let clock=100;const gate=createPledgeReadGate(()=>clock);gate.complete(gate.begin("alice|k1"));const lease=gate.capture("alice|k1");for(const changed of ["bob|k1","alice|k2"])expect(()=>gate.assert(lease,changed)).toThrow();clock=10101;expect(()=>gate.capture("alice|k1")).toThrow();expect(()=>gate.assert(lease,"alice|k1")).toThrow();});
 it("a successful later refresh still revokes the old preflight lease",()=>{const gate=createPledgeReadGate(()=>100);gate.complete(gate.begin("alice|k1"));const old=gate.capture("alice|k1");gate.complete(gate.begin("alice|k1"));expect(()=>gate.assert(old,"alice|k1")).toThrow();expect(()=>gate.capture("alice|k1")).not.toThrow();});
 it("manual and poll handlers share central failure cleanup and dispatch checks follow the last await",()=>{const s=readFileSync(new URL("../app/pledge/LivePledge.tsx",import.meta.url),"utf8");expect(s).toContain('setData(null);setInventory(null);setBundle(null);setLoading(false)');expect(s).toContain('disabled={busy||loading} onClick={()=>void refresh()');expect(s.indexOf('readGate.assert(lease,activeIdentity.current)')).toBeGreaterThan(s.indexOf('const height=await nextFinalBlockHeight'));expect(s).toContain('!!current&&!loading&&!busy');});
});
