import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
const checker=resolve('scripts/check-hygiene.py');
const path='docs/evidence/live-v2.7/promotion.public.json';
const original=JSON.parse(readFileSync(path,'utf8'));
function run(mutate=()=>{},file=path,raw){
 const root=mkdtempSync(join(tmpdir(),'keyhole-hygiene-'));
 try {
  const v=structuredClone(original);mutate(v);
  mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),raw??JSON.stringify(v));
  execFileSync('git',['init','-q'],{cwd:root});execFileSync('git',['add','.'],{cwd:root});
  return spawnSync('python3',[checker,'--root',root],{encoding:'utf8'});
 } finally {rmSync(root,{recursive:true,force:true});}
}
test('genuine exact-schema public deployment proof passes without losing its verifiable signature',()=>assert.equal(run().status,0));
test('every other field rejects synthetic credential classes and unknown private fields',()=>{
 const samples=['w'+'k_'+'a'.repeat(16),'BEGIN '+'OPENSSH PRIVATE KEY','eyJhb'+'Gci'+'A'.repeat(24),'ed25519:'+'2'.repeat(88)];
 for(const sample of samples)for(const field of ['private_key','private_seed','extra_signature']){
  const r=run(v=>{v.deployment.transaction[field]=sample;});assert.notEqual(r.status,0);assert.ok(!r.stdout.includes(sample));
 }
});
test('moved/extra/replaced signature, wrong tx, unknown schema, duplicate keys and malformed JSON fail',()=>{
 for(const mutate of [
  v=>{v.signature=v.deployment.transaction.signature;delete v.deployment.transaction.signature;},
  v=>{v.deployment.signature=v.deployment.transaction.signature;},
  v=>{v.deployment.transaction.signature='ed25519:'+'2'.repeat(88);},
  v=>{v.deployment.transaction.hash='wrong';},v=>{v.deployment.transaction_outcome.id='wrong';},
  v=>{v.schema='UNKNOWN';},v=>{v.extra={};},
 ])assert.notEqual(run(mutate).status,0);
 assert.notEqual(run(()=>{},path,'{"schema":"x","schema":"y"}').status,0);
 assert.notEqual(run(()=>{},path,'{').status,0);
});
test('same signature in any other file fails; no JSON/evidence/package-lock or heuristic exclusion',()=>{
 for(const file of ['elsewhere.json','docs/evidence/extra.json','cli/package-lock.json'])assert.notEqual(run(()=>{},file).status,0);
 for(const file of ['notes.txt','docs/evidence/new.json'])assert.notEqual(run(()=>{},file,'w'+'k_'+'a'.repeat(16)).status,0);
 assert.notEqual(run(()=>{},'escaped.json','{"x":"\\u0077k_'+'a'.repeat(16)+'"}').status,0);
 const workflow=readFileSync('.github/workflows/ci.yml','utf8');assert.match(workflow,/python3 scripts\/check-hygiene.py/);assert.doesNotMatch(workflow,/:!docs\/evidence/);
});
test('historical 1Click signatures retain only exact snapshot/pointer exceptions, not a file exclusion',()=>{
 for(const file of ['docs/evidence/oneclick-sol/b7_real_sol_to_near_usdc_4000000.json','docs/evidence/oneclick-sol/c6_status_success_4000000.json','docs/evidence/oneclick-sol/status_refunded_5sESFfrM.json']){
  const proof=JSON.parse(readFileSync(file));assert.equal(run(()=>{},file,JSON.stringify(proof)).status,0);
  proof.injected='w'+'k_'+'a'.repeat(16);assert.notEqual(run(()=>{},file,JSON.stringify(proof)).status,0);
 }
});
