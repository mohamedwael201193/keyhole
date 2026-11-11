import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {checkBudget} from './pilot-budget.mjs';
const good={scope:'native-A-repay-B-title-no-public-redemption',actual_final_receipts_reviewed:true,remaining_worst_case_reviewed:true,refunds_counted_only_when_final:true,near_final_spent_yocto:'100000000000000000000000',near_unresolved_max_yocto:'0',near_remaining_worst_yocto:'200000000000000000000000',near_off_reserve_yocto:'40000000000000000000000',usdc_source_raw:'900000',compute_reserved_micro_usd:'99000',base_eth_final_wei:'0',base_eth_remaining_max_wei:'50000000000000',receipt_refs:['fixture-only']};
test('scoped integer budget includes completed, unknown, worst remaining and OFF reserve',()=>{assert.equal(checkBudget(good),true);for(const patch of [{near_remaining_worst_yocto:'300000000000000000000000'},{near_unresolved_max_yocto:'100000000000000000000000'},{near_off_reserve_yocto:'0'},{usdc_source_raw:'900001'},{compute_reserved_micro_usd:'99001'},{base_eth_final_wei:'1'},{refunds_counted_only_when_final:false},{remaining_worst_case_reviewed:false},{receipt_refs:[]},{near_final_spent_yocto:'0.1'},{scope:'public-recovery'}])assert.throws(()=>checkBudget({...good,...patch}));});
test('exact exit scope requires both exit/native/admission reserves without raising caps',()=>{
 const v={...good,scope:'native-A-repay-B-title-exact-near-exit',exact_exit_native_max_yocto:'5000000000000000000000',exact_exit_admission_max_yocto:'20000000000000000000000'};
 assert.equal(checkBudget(v),true);
 for(const patch of [{exact_exit_native_max_yocto:'0'},{exact_exit_admission_max_yocto:'0'},{near_remaining_worst_yocto:'24000000000000000000000'},{near_final_spent_yocto:'300000000000000000000000'}])assert.throws(()=>checkBudget({...v,...patch}));
});
test('operator design names the exact three-hop flow without claiming live proof',()=>{
 for(const p of ['docs/worker/LIVE_LOANS_EXEC.md','docs/worker/LIVE_LOANS_DESIGN.md']) {
  const b=readFileSync(p,'utf8');assert.match(b,/exact-near-v1/);assert.match(b,/confidential\/unshield/);assert.match(b,/storage-deposit/);assert.match(b,/intents\/withdraw/);assert.match(b,/not.*live|not.*executed/i);
 }
});
