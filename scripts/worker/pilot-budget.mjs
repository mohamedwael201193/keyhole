// Read-only, integer-only execution gate; estimates/receipts are supplied by the operator.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function checkBudget(v){
 assert.equal(v.scope,'native-A-repay-B-title-no-public-redemption');
 assert.equal(v.actual_final_receipts_reviewed,true);
 assert.equal(v.remaining_worst_case_reviewed,true);
 assert.equal(v.refunds_counted_only_when_final,true);
 const n=k=>{assert.match(v[k]??'',/^(0|[1-9][0-9]*)$/);return BigInt(v[k]);};
 const off=n('near_off_reserve_yocto');assert.ok(off>=40000000000000000000000n,'retain >=0.04 NEAR OFF/incident reserve');
 assert.ok(n('near_final_spent_yocto')+n('near_unresolved_max_yocto')+n('near_remaining_worst_yocto')+off<=400000000000000000000000n,'STOP: NEAR completion envelope >0.4');
 const source=n('usdc_source_raw'),compute=n('compute_reserved_micro_usd');
 assert.ok(source<=900000n&&compute<=99000n&&source+compute<=999000n,'STOP: collateral + key-2 compute >0.999 USDC-equivalent');
 assert.ok(n('base_eth_final_wei')+n('base_eth_remaining_max_wei')<=50000000000000n,'STOP: Base ETH incl L1 fee >0.00005');
 assert.ok(Array.isArray(v.receipt_refs)&&v.receipt_refs.length>0&&v.receipt_refs.every(x=>typeof x==='string'&&x.length>0),'actual reviewed receipt/quote/estimate refs required');
 return true;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){checkBudget(JSON.parse(readFileSync(process.argv[2])));console.log('PASS scoped native pilot budget including completion/OFF reserve');}
