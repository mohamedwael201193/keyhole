import type {KeysCall} from "../../lib/keysTx";
import {matchesMoneyReceipt} from "../../lib/pledgeMoney";
export type WalletRole="borrower"|"lender";
export const FUNDED_WALLET_PLAN:readonly (readonly [WalletRole,string])[]=[
 ["borrower","open_loan"],["lender","fund_loan"],["borrower","claim_payout"],
 ["borrower","repay_loan"],["borrower","retry_loan_policy"],["lender","claim_payout"],["borrower","claim_payout"],
 ["borrower","open_loan"],["lender","fund_loan"],["borrower","claim_payout"],
 ["lender","claim_default"],["lender","retry_loan_policy"],["borrower","claim_payout"],
];
export type WalletSubmission={role:WalletRole;hash:string;account:string;contract:string;calls:KeysCall[]};
export type FinalWalletReceipt={final_execution_status:string;status:Record<string,unknown>;transaction:{hash:string;signer_id:string;receiver_id:string;actions:unknown[]};receipts_outcome:{outcome:{status:Record<string,unknown>}}[]};
/** Every browser-wallet submission, NOT a census of fixture/provider admission transactions. */
export function assertFundedWalletLedger(submissions:WalletSubmission[],receipts:FinalWalletReceipt[]):void {
 if(submissions.length!==13||receipts.length!==13)throw Error("Expected exactly 13 browser-wallet submissions and FINAL receipts");
 if(new Set(submissions.map(x=>x.hash)).size!==13||new Set(receipts.map(x=>x.transaction.hash)).size!==13)throw Error("Duplicate wallet transaction hash");
 for(let i=0;i<13;i++){
  const x=submissions[i],r=receipts[i],[role,method]=FUNDED_WALLET_PLAN[i];
  if(x.role!==role||x.calls.at(-1)?.method!==method)throw Error(`Unexpected wallet submission ${i+1}`);
  if(!matchesMoneyReceipt({account:x.account,contract:x.contract,call:x.calls.at(-1)!,calls:x.calls,txHash:x.hash,status:"Submitted",minBlockHeight:"1"},r))throw Error(`Receipt action/identity mismatch ${i+1}`);
  if(!Object.hasOwn(r.status,"SuccessValue")||Object.hasOwn(r.status,"Failure"))throw Error(`Wallet execution failed ${i+1}`);
  // These two fixture steps deliberately refuse the lower thaw, then finish via the callback.
  // The native transaction must still succeed; only the specifically labelled mock failure is allowed.
  const failures=r.receipts_outcome.filter(x=>Object.hasOwn(x.outcome.status,"Failure"));
  const refused=method==="repay_loan"||method==="claim_default";
  if(failures.length!==(refused?1:0)||failures.some(x=>!JSON.stringify(x.outcome.status).includes("mock provider refuses thaw")))throw Error(`Unexpected receipt outcome ${i+1}`);
 }
}
