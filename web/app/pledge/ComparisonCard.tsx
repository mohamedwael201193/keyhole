import {compareLoanSwap,type ComparisonInput} from "@/lib/pledgeEconomics";
export function ComparisonCard({input}:{input:ComparisonInput}) {
 const result=compareLoanSwap(input);
 return <details className="plg-risks" data-testid="loan-swap-comparison"><summary>Loan or partial swap?</summary>
  <p>Same net usable NEAR now, after the loan bond and quoted upfront cash costs; restore the same USDC later. Both keep the NFT/address.</p>
  <p>Bond: {near(result.upfrontBond)} NEAR locked, not a fee. Net after bond alone: {near(result.netAfterBondBeforeCosts)} NEAR. {result.available?<>After quoted incremental cash costs: {near(result.usableNowAfterQuotedCosts)} NEAR.</>:<>All-cost usable liquidity is not yet quoted.</>} Setup, route, compute and gas costs require fresh quotes before a comparison.</p>
  {!result.available?<p role="status">{result.message}. No same-ledger current forward/reverse quotes are available here.</p>:<><p>{result.recommendation}</p><p>Loan net native outflow after confirmed full bond return: {near(result.loanAfterBondReturn)} NEAR. Quoted upfront cash costs are counted once in matched current liquidity, not added twice at repayment. The full repayment must still be available before that refund.</p><p>Source: {result.source} · {result.route}</p><ul>{result.scenarios.map(s=><li key={s.pricePercent}>Hypothetical NEAR price {s.pricePercent}% of today: {near(s.swapRestoreNear)} NEAR to restore the same USDC.</li>)}</ul><p>{result.risks}</p></>}
  <p>Fixed repayment: {near(result.loanRepayment)} NEAR. Expected future NEAR income is not guaranteed. Frozen USDC is unavailable; default forfeits the entire account. Unpriced lock, default and availability risks are not zero.</p>
 </details>;
}
function near(value:string){const v=BigInt(value),neg=v<0n,n=neg?-v:v;return `${neg?"-":""}${n/10n**24n}.${(n%10n**24n).toString().padStart(24,"0").replace(/0+$/,"")||"0"}`;}
