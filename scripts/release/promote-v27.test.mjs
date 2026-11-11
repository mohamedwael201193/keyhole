import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateV27,HASH,TX} from './promote-v27.mjs';
const id=JSON.parse(readFileSync('identity.json'));
const evidence=JSON.parse(readFileSync('docs/evidence/live-v2.7/promotion.public.json'));
const artifact=readFileSync('contracts/keys/release/v2.7/keyhole_keys.wasm');
test('v2.7 promotion proves FINAL exact bytes and preserves immutable authorities/history/worker',()=>{
 const before=structuredClone(id);
 const result=validateV27(id,evidence,artifact);
 assert.equal(result.version,'2.7.0');assert.equal(result.wasm_sha256,HASH);assert.equal(result.deploy_tx,TX);
 for(const k of ['account','minter','recovery_account','migrate_pledge_tx'])assert.equal(result[k],id.contract[k]);
 assert.deepEqual(result.historical_deployments,id.contract.historical_deployments);
 assert.deepEqual(id,before);
});
for(const [name,mutate] of [
 ['hash',e=>e.code.sha256='0'.repeat(64)],['version',e=>e.metadata.version='2.6.0'],
 ['minter',e=>e.config.minter='1'.repeat(64)],['attestor',e=>e.pledge.attestor_public_key='wrong'],
 ['recovery',e=>e.pledge.recovery_account='wrong.near'],['lending',e=>e.pledge.lending_enabled=true],
 ['not FINAL',e=>e.deployment.final_execution_status='EXECUTED'],['wrong receipt',e=>e.deployment.transaction.hash='wrong'],
 ['wrong action',e=>e.deployment.transaction.actions[0].DeployContract.code='AAAA'],
 ['failure',e=>e.deployment.receipts_outcome[0].outcome.status={Failure:{}}],
 ['missing lineage',e=>e.deployment.receipts_outcome=[]]
]) test(`v2.7 promotion rejects ${name}`,()=>{const e=structuredClone(evidence);mutate(e);assert.throws(()=>validateV27(id,e,artifact));});
test('v2.7 promotion rejects modified local release bytes',()=>assert.throws(()=>validateV27(id,evidence,Buffer.from('wrong'))));

test('v2.7 evidence promotion preserves the prior deployment instead of erasing history',()=>{
 const historical={...id,contract:{...id.contract,version:'2.6.0',deploy_tx:'old-reviewed-deployment',wasm_sha256:'b'.repeat(64)}};
 const result=validateV27(historical,evidence,artifact);
 assert.ok(result.historical_deployments.some(x=>x.deploy_tx==='old-reviewed-deployment'));
 assert.equal(result.migrate_pledge_tx,historical.contract.migrate_pledge_tx);
});
test('v2.7 evidence capture re-reads one pinned block, real bytes and original receipt',async()=>{
 const {promoteV27}=await import('./promote-v27.mjs');
 const seen=[];
 const call=async(method,params)=>{
  seen.push([method,params]);
  if(method==='block')return {header:{hash:evidence.block.hash,height:evidence.block.height}};
  if(method==='tx')return evidence.deployment;
  if(params.request_type==='view_account')return evidence.account;
  if(params.request_type==='view_code')return {code_base64:artifact.toString('base64')};
  return {result:[...Buffer.from(JSON.stringify(({config:evidence.config,get_pledge_config:evidence.pledge,contract_source_metadata:evidence.metadata})[params.method_name]))]};
 };
 const out=await promoteV27(id,evidence,process.cwd()+'/',call);
 assert.equal(out.deploy_tx,TX);
 assert.ok(seen.filter(([m])=>m==='query').every(([,p])=>p.block_id===evidence.block.hash));
 const tampered=structuredClone(evidence);tampered.deployment.transaction.hash='invented';
 await assert.rejects(promoteV27(id,tampered,process.cwd()+'/',call),/differs from RPC/);
});
