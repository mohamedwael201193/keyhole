// Candidate-scoped reproducible source validation, never live-provider evidence.
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../..',import.meta.url));
const read=p=>readFileSync(resolve(root,p));
const sha=b=>createHash('sha256').update(b).digest('hex');
const dir='docs/evidence/worker-provisioning/v2/r3/';
const walk=p=>readdirSync(resolve(root,p),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p+'/'+e.name):[p+'/'+e.name]);
export function sourceDigest() {
 const paths=[...walk('tee/worker/src'),...walk('tee/worker/wit'),'tee/worker/Cargo.toml','tee/worker/Cargo.lock','tee/worker/build.sh','tee/worker/rust-toolchain.toml'].sort();
 return sha(paths.map(p=>p+'\0'+sha(read(p))+'\n').join(''));
}
export function validateRecord(record,id,digest,counts) {
 assert.equal(record.status,'source-candidate-not-published');
 assert.deepEqual(record.worker_candidate,id.worker_candidate);
 assert.equal(record.source_tree_sha256,digest);
 assert.deepEqual(record.tests,counts);
 const js=record.javascript_summary;
 for(const value of Object.values(js))assert.ok(Number.isSafeInteger(value)&&value>=0);
 assert.equal(js.passed,counts.javascript);
 assert.equal(js.total,js.passed+js.failed+js.cancelled+js.skipped);
 for(const [name,count] of Object.entries(record.tests))assert.ok(Number.isSafeInteger(count)&&count>0,`missing/invalid test count ${name}`);
 assert.equal(record.source_commit_reference,'identity.json#/review/source_commit');
 assert.ok(record.tests.worker>=711 && record.tests.javascript>=151 && record.tests.receipts===9);
 assert.equal(record.actual_wasi_builds[0],id.worker_candidate.wasm_sha256);
 assert.equal(record.actual_wasi_builds[1],id.worker_candidate.wasm_sha256);
}
export function nodeCounts(log) { return Object.fromEntries(['total','passed','failed','cancelled','skipped'].map((name,i)=>[name,Number(log.match(new RegExp('^# '+['tests','pass','fail','cancelled','skipped'][i]+' (\\d+)$','m'))?.[1]||0)])); }
export function browserCounts(log) { return {passed:Number(log.match(/(\d+) passed/)?.[1]||0),retry_passes:Number(log.match(/(\d+) flaky/)?.[1]||0),skipped:Number(log.match(/(\d+) skipped/)?.[1]||0)}; }
export function makeRecord() {
 const worker=[...read(dir+'worker-tests.log').toString().matchAll(/test result: ok\. (\d+) passed/g)].reduce((s,m)=>s+Number(m[1]),0);
 const javascript_summary=nodeCounts(read(dir+'js-tests.log').toString()),js=javascript_summary.passed;
 const receipts=Number(read(dir+'receipt-tests.log').toString().match(/Ran (\d+) tests/)?.[1]);
 const cli=Number(read(dir+'cli-tests.log').toString().match(/# pass (\d+)/)?.[1]);
 const web=Number(read(dir+'web-tests.log').toString().match(/Tests\s+(\d+) passed/)?.[1]);
 const sandbox=Number(read(dir+'sandbox-pledge.log').toString().match(/test result: ok\. (\d+) passed/)?.[1]);
 const contract=[...read(dir+'contract-unit.log').toString().matchAll(/test result: ok\. (\d+) passed/g)].reduce((s,m)=>s+Number(m[1]),0);
 const sandbox_other=[...read(dir+'sandbox-other.log').toString().matchAll(/test result: ok\. (\d+) passed/g)].reduce((s,m)=>s+Number(m[1]),0);
 const funded=Number(read(dir+'funded-e2e.log').toString().match(/(\d+) passed/)?.[1]);
 const browser=browserCounts(read(dir+'web-e2e.log').toString());
 return {status:'source-candidate-not-published',credit:'devmo',source_commit_reference:'identity.json#/review/source_commit',source_tree_sha256:sourceDigest(),worker_candidate:JSON.parse(read('identity.json')).worker_candidate,tests:{worker,javascript:js,receipts,cli,web,contract,sandbox_pledge:sandbox,sandbox_other,sandbox_total:sandbox+sandbox_other,funded_browser:funded,general_browser:browser.passed+browser.retry_passes},general_browser_summary:browser,javascript_summary,actual_wasi_builds:['build1.sha256','build2.sha256'].map(p=>read(dir+p).toString().trim()),coverage_qualifications:{javascript:'Exact full-suite totals include failures; a source-candidate metadata PASS is not all-suites-green or hosted CI approval.',funded_browser:'Current funded real-native sandbox UI fixture, including both repay/default endings and unchanged refusal/no-custody assertions; not real custody or FT-delivery evidence.',sandbox_pledge:'Current local native admission/title/finish with mocked custody ledger; no actual token/Intents provider.',general_browser:'Current production preview/consent guard with explicit mocked wallet, custody and RPC; no live wallet/provider.'},live_provider_installation:false,live_loans:false,logs:['worker-tests.log','js-tests.log','receipt-tests.log','cli-tests.log','web-tests.log','web-lint.log','web-typecheck.log','sandbox-pledge.log','sandbox-other.log','sandbox-clippy.log','funded-e2e.log','web-e2e.log','hygiene-tests.log','contract-unit.log','contract-clippy.log','clippy-native.log','clippy-wasi.log','build1.log','build2.log'].map(p=>({path:dir+p,sha256:sha(read(dir+p))}))};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const actual=makeRecord(),id=JSON.parse(read('identity.json'));
 if(process.argv.includes('--write'))writeFileSync(resolve(root,dir+'validation.json'),JSON.stringify(actual,null,2)+'\n');
 const record=JSON.parse(read(dir+'validation.json'));
 validateRecord(record,id,sourceDigest(),actual.tests);
 assert.deepEqual(record,actual);
 const readme=read('README.md').toString();
 assert.ok(readme.includes(`TEE worker unit tests | **${record.tests.worker}**`));
 for(const p of ['docs/worker/confinement-v2.md',dir+'validation.json','tee/worker/src/collateral_evidence/tests.rs'])assert.ok(readme.includes(p));
 console.log('PASS candidate source digest, exact counts, artifacts, logs and proof links');
}
