import {test} from 'node:test';import assert from 'node:assert/strict';
import {checkReceipt} from './native-pilot-receipt.mjs';
const row=(id,executor_id,receipt_ids,status)=>({id,outcome:{executor_id,receipt_ids,status}});
const good={final_execution_status:'FINAL',transaction:{hash:'original',signer_id:'borrower.near',receiver_id:'keys.near'},status:{SuccessValue:''},transaction_outcome:row('original','borrower.near',['call'],{SuccessReceiptId:'call'}),receipts_outcome:[row('call','keys.near',['transfer','callback'],{SuccessValue:''}),row('transfer','borrower.near',[],{SuccessValue:''}),row('callback','keys.near',[],{SuccessValue:''})]};
test('native pilot requires original FINAL all-success closed graph, not top-level success or an unrelated receipt',()=>{
 assert.equal(checkReceipt(good,'original','borrower.near','keys.near'),true);
 for(const mutate of [r=>r.final_execution_status='EXECUTED_OPTIMISTIC',r=>r.transaction.hash='other',r=>r.transaction.signer_id='other.near',r=>r.transaction.receiver_id='other.near',r=>r.receipts_outcome[1].outcome.status={Failure:'failed FT delivery'},r=>r.receipts_outcome.pop(),r=>r.receipts_outcome.push(row('orphan','keys.near',[],{SuccessValue:''})),r=>r.receipts_outcome.push(r.receipts_outcome[0]),r=>r.receipts_outcome[2].outcome.receipt_ids=['original'],r=>r.receipts_outcome[0].outcome.receipt_ids.push('transfer'),r=>r.transaction_outcome.outcome.status={Unknown:''}]){const r=structuredClone(good);mutate(r);assert.throws(()=>checkReceipt(r,'original','borrower.near','keys.near'));}
});
