import {it,expect,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
vi.mock("@/lib/wallet",()=>({useWallet:()=>({accountId:null,pending:null,connect(){}})}));
import {exactUnits,units,LivePledge,lifecycleState} from "@/app/pledge/LivePledge";
import {checkBody} from "@/lib/gateway";
it("loan and USDC amounts use exact integers, not floating point",()=>{expect(exactUnits("0.0101")).toBe("10100000000000000000000");expect(exactUnits("0.10",6)).toBe("100000");expect(units("-2200000000000000000000")).toBe("−0.0022");expect(units("100000",6)).toBe("0.1");});
it("refuses exponents, signs, excess precision, zero and overflowing deposits",()=>{for(const v of ["1e-3","-0.1","+1","0","NaN","0.0000000000000000000000001","340282366920939463463374607431768211456"]){expect(()=>exactUnits(v)).toThrow();}});
it("private inventory and original-exit reconciliation never become public requests",()=>{for(const op of ["pledge_inventory","reconcile_value_op"]){expect(checkBody(JSON.stringify({op,params:{token_id:"k1"}})).ok).toBe(false);expect(checkBody(JSON.stringify({op})).ok).toBe(false);}});
it("anonymous lender initially has no private inventory or executable financial CTA",()=>{const html=renderToStaticMarkup(createElement(LivePledge,{tokenId:"k1",role:"lender"}));expect(html).toContain("Declared, not yet verified");expect(html).not.toContain("swap quote unavailable");expect(html).not.toContain("Compare with a swap");expect(html).not.toContain("Read private at-risk inventory");expect(html).not.toContain("Register &amp; fund");expect(html).toContain("Default transfers everything");});
it("policy and money uncertainty have no timeout unlock or sequential wallet fallback",()=>{const s=readFileSync(new URL("../app/pledge/LivePledge.tsx",import.meta.url),"utf8");expect(s).toContain("dispatchMoneyBatch");expect(s).toContain("finalMoneyReceipt");expect(s).toContain("policy_call_complete");expect(s).toContain("No redispatch or timeout unlock");expect(s).toContain("dispatchExitContinuation");const exit=readFileSync(new URL("../lib/pledgeExit.ts",import.meta.url),"utf8");expect(exit.indexOf("store.replace(original,next)")).toBeLessThan(exit.indexOf("await send(auth)"));expect(exit).toContain('status:"UNKNOWN"');expect(s).toContain('saved.status!=="AwaitingSignature"');expect(s).toContain("request.account_id!==account");expect(s).not.toContain("Date.now()");});
it("a failed chain read cannot turn a remembered loan into a fabricated terminal ending",()=>{
 const last={state:"Active" as const,due_ns:"123",borrower:"borrower.near"};
 expect(lifecycleState(null,last)).toBe("Chain state unavailable");
 expect(lifecycleState({owner:null,loan:null},last)).toBe("Chain state unavailable");
 expect(lifecycleState({owner:"borrower.near",loan:{state:"DisbursementPending"}},last)).toBe("Funds ready to claim");
 for(const owner of ["borrower.near","lender.near","later-buyer.near"]){
  expect(lifecycleState({owner,loan:null},last)).toBe("Closed · history unverified");
  expect(lifecycleState({owner,loan:null},{...last,resolution:"repaid"})).toBe("Repaid · unlock confirmed");
  expect(lifecycleState({owner,loan:null},{...last,resolution:"default_claimed"})).toBe("Loan defaulted · unlock confirmed");
  expect(lifecycleState({owner,loan:null},{...last,resolution:"canceled"})).toBe("Canceled · unlock confirmed");
 }
 expect(lifecycleState({owner:"borrower.near",loan:null},{...last,state:"Offered",due_ns:"0"})).toBe("Closed · history unverified");
 expect(lifecycleState({owner:"borrower.near",loan:null},{...last,resolution:"unexpected"})).toBe("Closed · history unverified");
});
