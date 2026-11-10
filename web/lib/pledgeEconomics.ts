/** Identical starting portfolios and usable cash after refundable bond + quoted upfront cash costs. Fees counted once. */
export type MatchedQuote = { ledger: string; route: string; expiresAtMs: number; usableNearYocto: string; usdcDebitRaw: string; restoreUsdcRaw: string; reverseNearYocto: string; reverseFixedFeeYocto: string; source: string };
export type ComparisonInput = { principal: string; repayment: string; bond: string; incrementalLoanCost: string; payoutStorageCost: string | null; quote: MatchedQuote | null; ledger: string; nowMs: number };
export function compareLoanSwap(x: ComparisonInput) {
 const p=BigInt(x.principal),r=BigInt(x.repayment),bond=BigInt(x.bond),slot=x.payoutStorageCost===null?0n:BigInt(x.payoutStorageCost),incremental=BigInt(x.incrementalLoanCost),cost=incremental+slot;
 if(p<=0n||r<p||bond<0n||cost<0n||slot<0n||incremental<0n) throw Error("Invalid nonnegative exact native terms");
 const base={payoutStorageCost:x.payoutStorageCost,upfrontBond:bond.toString(),netAfterBondBeforeCosts:(p-bond).toString(),usableNowAfterQuotedCosts:(p-bond-cost).toString(),loanRepayment:r.toString(),loanAfterBondReturn:(r-bond).toString()};
 const q=x.quote;
 if(x.payoutStorageCost===null||p<=bond+cost||!q||q.ledger!==x.ledger||q.expiresAtMs<=x.nowMs||!q.source||!q.route||BigInt(q.usableNearYocto)!==p-bond-cost||BigInt(q.usdcDebitRaw)<=0n||q.restoreUsdcRaw!==q.usdcDebitRaw)
  return {...base,available:false as const,message:"Comparison unavailable at this size"};
 const reverse=BigInt(q.reverseNearYocto),fixed=BigInt(q.reverseFixedFeeYocto);
 if(reverse<=0n||fixed<0n||fixed>reverse) throw Error("Invalid reverse benchmark");
 // Fixed quoted reverse fees remain fixed. All embedded quote fees are counted once.
 const scenarios=[80n,100n,120n].map(pricePercent=>({pricePercent:Number(pricePercent),swapRestoreNear:(((reverse-fixed)*100n+pricePercent-1n)/pricePercent+fixed).toString()}));
 return {...base,available:true as const,source:q.source,route:q.route,scenarios,
  // Match both current net liquidity and final native holdings after full bond return.
  recommendation:r-bond>reverse?"A partial swap is simpler for these terms":"Compare the temporary lock, whole-account default and availability risks before choosing",
  risks:"Assumes timely repayment, confirmed full bond return and identical starting portfolios. Cash needed before the refund remains the full repayment; capital timing is not free. Future prices are hypothetical, not forecasts. Frozen USDC cannot be spent. Whole-account forfeiture, income default, provider and availability risks are not priced as zero. Both routes retain the NFT/address."};
}
