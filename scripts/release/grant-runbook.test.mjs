import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const script=resolve('scripts/worker/outlayer-grant.sh');
test('grant submit AND polling explicitly bind key-2 CLI auth, reject before dispatch',()=>{
 const d=mkdtempSync(join(tmpdir(),'grant-fixture-'));
 try {
  writeFileSync(join(d,'out'),`#!/bin/bash\ncase "$PAYMENT_KEY" in keyhole-devmo.near:2:fixture-only) ;; *) exit 9;; esac\nprintf '%s %s\\n' "$1" 'payer=keyhole-devmo.near nonce=2 auth-header=redacted' >> "$E/calls"\n`,{mode:0o700});
  const env={PATH:process.env.PATH,E:d,OUT:join(d,'out'),HNEW:'a'.repeat(64)};
  const run=key=>spawnSync('bash',['-c',`source "$1"; worker_call fixture.json && worker_status original-id`,'fixture',script],{env:{...env,...(key===undefined?{}:{OUTLAYER_PAYMENT_KEY:key})},encoding:'utf8'});
  for(const key of [undefined,'keyhole-devmo.near:1:fixture-only','wrong.near:2:fixture-only','keyhole-devmo.near:2:']) {
   assert.notEqual(run(key).status,0);
  }
  assert.equal(run('keyhole-devmo.near:2:fixture-only').status,0);
  assert.equal(readFileSync(join(d,'calls'),'utf8'),'run payer=keyhole-devmo.near nonce=2 auth-header=redacted\nstatus payer=keyhole-devmo.near nonce=2 auth-header=redacted\n');
  assert.equal(readFileSync(join(d,'compute.reserved.micro-usd'),'utf8'),'3000\n');
  const source=readFileSync(script,'utf8');
  assert.match(source,/https:\/\/api.outlayer.ai\/public\/payment-keys\/keyhole-devmo.near\/2\/balance/);
  assert.doesNotMatch(source,/keys\s+(topup|show)/);
  assert.match(source,/--async --compute-limit 3000/);
 } finally {rmSync(d,{recursive:true,force:true});}
});

test('versioned operator runbook cannot select personal key 1 or unbound execution',()=>{
 const book=readFileSync('docs/worker/LIVE_LOANS_EXEC.md','utf8');
 assert.match(book,/OUTLAYER_PAYMENT_KEY/);assert.match(book,/worker_status/);
 assert.doesNotMatch(book,/keys\s+(show\s+1|topup)|keyhole-devmo.near:1:|\/1\/balance/);
 assert.match(book,/exact-near-v1/);assert.match(book,/unshield/);assert.match(book,/no.*replacement|never.*resend/i);
 assert.doesNotMatch(book,/make_input "\$HOLDERKEY" withdraw "/);
});
