import { describe, it, expect } from "vitest";
import { exactExitFields, EXACT_EXIT_MODE, EXACT_EXIT_USDC } from "@/lib/exactExit";
import { withdrawDryRunDecision, exitConfirmText } from "@/lib/withdrawDryRun";
const intent={account:"alice.near",token:EXACT_EXIT_USDC,amount:"100",chain:"near"};
const preview={ok:true,op:"withdraw_dry_run",to:intent.account,token:intent.token,amount:"100",chain:"near",amount_out:"100",min_amount_out:"100",broadcast:false,exit_mode:EXACT_EXIT_MODE,advisory_only:true,execution_supported:true,requires_unshield_readback:true};
describe("explicit exact-amount consent",()=>{
 it("binds exact output to the signed amount, mode and short deadline",()=>expect(exactExitFields("100",1000)).toEqual({exit_mode:EXACT_EXIT_MODE,min_amount_out:"100",deadline_ms:301000}));
 it.each(["0","01","-1","1.0","1e3","340282366920938463463374607431768211456"])("refuses malformed amount %s",a=>expect(()=>exactExitFields(a)).toThrow());
 it("permits only the new explicitly tagged candidate preview",()=>expect(withdrawDryRunDecision(preview,intent)).toEqual({ok:true,amount_out:"100",min_amount_out:"100"}));
 it.each(["exit_mode","execution_supported","requires_unshield_readback","advisory_only"])("requires %s",k=>expect(withdrawDryRunDecision({...preview,[k]:undefined},intent).ok).toBe(false));
 it.each(["99","101"])("never accepts different exact output %s",a=>expect(withdrawDryRunDecision({...preview,amount_out:a},intent).ok).toBe(false));
 it("explains public reveal, three hops, approvals and no unknown resend",()=>{const s=exitConfirmText({amount_out:"100",min_amount_out:"100"},"100");for(const t of ["Unshield","public chain","register","exactly","approval","never automatically retry"])expect(s).toContain(t);});
});
