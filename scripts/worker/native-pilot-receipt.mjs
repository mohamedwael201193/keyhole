// Read-only FINAL graph guard. Does not submit, sign, infer FT/native delivery
// amounts from balances, or claim an unavailable confidential exit succeeded.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function checkReceipt(r,hash,signer,receiver){
 assert.equal(r?.final_execution_status,'FINAL');assert.equal(r.transaction?.hash,hash);assert.equal(r.transaction.signer_id,signer);assert.equal(r.transaction.receiver_id,receiver);
 const success=s=>s&&Object.keys(s).length===1&&typeof s.SuccessValue==='string';
 assert.ok(success(r.status),'terminal root success required');
 const root=r.transaction_outcome,rows=r.receipts_outcome;
 assert.equal(root?.id,hash);assert.equal(root.outcome?.executor_id,signer);
 assert.ok(Array.isArray(rows)&&rows.length>0&&rows.length<=256);
 const all=[root,...rows],map=new Map();
 for(const row of all){assert.ok(typeof row.id==='string'&&row.id.length>0&&!map.has(row.id),'missing/duplicate ID');map.set(row.id,row);assert.ok(typeof row.outcome?.executor_id==='string');assert.ok(Array.isArray(row.outcome.receipt_ids));assert.equal(new Set(row.outcome.receipt_ids).size,row.outcome.receipt_ids.length);}
 const seen=new Set(),active=new Set();
 function walk(id){
  assert.ok(!active.has(id),'cycle');assert.ok(!seen.has(id),'ambiguous shared descendant');
  const row=map.get(id);assert.ok(row,'missing receipt descendant');active.add(id);seen.add(id);
  const o=row.outcome,s=o.status;
  if(!success(s)){assert.ok(s&&Object.keys(s).length===1&&typeof s.SuccessReceiptId==='string'&&o.receipt_ids.includes(s.SuccessReceiptId),'nonterminal/failed/wrong status');}
  for(const child of o.receipt_ids)walk(child);
  active.delete(id);
 }
 walk(hash);assert.equal(seen.size,map.size,'orphan outcome');
 assert.ok(rows.some(x=>x.outcome.executor_id===receiver),'missing intended receiver execution');
 return true;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const [file,hash,signer,receiver]=process.argv.slice(2);checkReceipt(JSON.parse(readFileSync(file)),hash,signer,receiver);console.log('PASS original FINAL all-success closed receipt graph; inspect exact actions/amount/state separately');}
