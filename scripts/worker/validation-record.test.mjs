import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRecord,browserCounts} from './validation-record.mjs';
const candidate={status:'source-candidate-not-published',wasm_sha256:'a'.repeat(64),bytes:1};
const counts={worker:718,javascript:167,receipts:9};
const good={status:candidate.status,worker_candidate:candidate,tests:counts,source_tree_sha256:'source',source_commit_reference:'identity.json#/review/source_commit',actual_wasi_builds:[candidate.wasm_sha256,candidate.wasm_sha256]};
test('candidate record requires exact counts, source digest and both actual artifact hashes',()=>{
 assert.doesNotThrow(()=>validateRecord(good,{worker_candidate:candidate},'source',counts));
 for(const patch of [{tests:{...counts,worker:656}},{source_tree_sha256:'old-source'},{actual_wasi_builds:['old-hash',candidate.wasm_sha256]},{status:'published-mainnet'}])assert.throws(()=>validateRecord({...good,...patch},{worker_candidate:candidate},'source',counts));
});
test('browser summaries distinguish clean passes, retry passes and opt-in skips',()=>{
 assert.deepEqual(browserCounts('  2 flaky\n  15 skipped\n  215 passed (2m)'),{passed:215,retry_passes:2,skipped:15});
 assert.deepEqual(browserCounts('  217 passed (2m)'),{passed:217,retry_passes:0,skipped:0});
});
