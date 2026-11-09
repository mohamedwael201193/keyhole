import {describe,it,expect} from "vitest";
import {compareLoanSwap,type ComparisonInput} from "@/lib/pledgeEconomics";
const input:ComparisonInput={principal:"10000",repayment:"10100",bond:"9000",incrementalLoanCost:"100",ledger:"CONFIDENTIAL",nowMs:100,quote:{ledger:"CONFIDENTIAL",route:"same-ledger",expiresAtMs:200,usableNearYocto:"10000",usdcDebitRaw:"500",restoreUsdcRaw:"500",reverseNearYocto:"10000",reverseFixedFeeYocto:"100",source:"test-only injected quote"}};
describe("honest matched-portfolio comparison",()=>{
 it("counts bond as locked capital, not a burned fee; swap wins unchanged low-friction example",()=>{const r=compareLoanSwap(input);if(!r.available)throw Error();expect(r.netAfterBondBeforeCosts).toBe("1000");expect(r.recommendation).toBe("A partial swap is simpler for these terms");});
 it.each([null,{...input.quote!,ledger:"INTENTS"},{...input.quote!,expiresAtMs:100},{...input.quote!,restoreUsdcRaw:"400"},{...input.quote!,usableNearYocto:"9999"}])("rejects absent, stale, wrong-ledger or unequal-portfolio quotes",quote=>expect(compareLoanSwap({...input,quote}).available).toBe(false));
 it("NEAR appreciation reduces NEAR needed later; fixed fees are not scaled",()=>{const r=compareLoanSwap(input);if(!r.available)throw Error();expect(r.scenarios.map(x=>x.swapRestoreNear)).toEqual(["12475","10000","8350"]);expect(r.risks).toContain("not priced as zero");});
 it("never invents a quote, numerical risk premium or generic savings claim",()=>{const r=compareLoanSwap({...input,quote:null});if(r.available)throw Error();expect(r.message).toBe("Comparison unavailable at this size");});
});
