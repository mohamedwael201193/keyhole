import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export function validateCandidate(bytes, identity, candidate, sum) {
 const hash=createHash('sha256').update(bytes).digest('hex');
 if (!identity.worker_candidate || hash!==identity.worker_candidate.wasm_sha256 || bytes.length!==identity.worker_candidate.bytes || hash!==candidate.wasm_sha256 || bytes.length!==candidate.bytes || sum.trim()!==hash) throw Error('rebuilt worker candidate SHA256/byte equality failed');
 return hash;
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
 const read=p=>readFileSync(resolve(root,p));
 console.log('PASS candidate byte equality '+validateCandidate(read('tee/worker/target/wasm32-wasip2/release/keyhole-worker.wasm'),JSON.parse(read('identity.json')),JSON.parse(read('docs/evidence/worker-provisioning/candidate.json')),read('tee/worker/CANDIDATE_SHA256').toString()));
}
