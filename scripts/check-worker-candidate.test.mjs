import {test} from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {validateCandidate} from './check-worker-candidate.mjs';
const bytes=Buffer.from('candidate');const hash=createHash('sha256').update(bytes).digest('hex');const c={wasm_sha256:hash,bytes:bytes.length};
test('candidate equality requires rebuilt bytes and every independent mirror',()=>assert.equal(validateCandidate(bytes,{worker_candidate:c},c,hash),hash));
test('a changed worker cannot pass with stale identity or manifest',()=>assert.throws(()=>validateCandidate(Buffer.from('changed'),{worker_candidate:c},c,hash)));
test('wrong size or any stale candidate mirror fails',()=>{for(const [id,manifest,sum] of [[{...c,bytes:0},c,hash],[c,{...c,bytes:0},hash],[c,c,'0'.repeat(64)],[c,{...c,wasm_sha256:'0'.repeat(64)},hash]])assert.throws(()=>validateCandidate(bytes,{worker_candidate:id},manifest,sum));});
