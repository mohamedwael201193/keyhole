import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkLog, checkAttestation, canonical, sha } from './readme-verify.mjs';
const output = JSON.parse(readFileSync(new URL('../docs/evidence/readme-verification/public-log.json', import.meta.url))).output;
test('real public swap log verifies 32 signed events and 10 swaps', () => {
  assert.deepEqual(checkLog(output), { events: 32, swaps: 10, head: output.head });
});
for (const [name, mutate] of [
  ['owner tamper', j => { j.events[0].owner = 'attacker.near'; }],
  ['swap detail commitment tamper', j => { j.events[20].detail_hash = 'f'.repeat(64); }],
  ['missing signature', j => { delete j.sig; }],
  ['wrong signature', j => { j.sig = '0'.repeat(128); }],
  ['wrong token', j => { j.token_id = 'different-key'; }],
  ['missing events', j => { j.events = []; }],
  ['reordered events', j => { [j.events[0],j.events[1]] = [j.events[1],j.events[0]]; }],
  ['truncated log', j => { j.events.pop(); }],
  ['edited head', j => { j.head = '0'.repeat(64); }],
]) test(`rejects ${name}`, () => { const j = structuredClone(output); mutate(j); assert.throws(() => checkLog(j)); });
test('rejects a valid log from a signer other than the current minter', () => assert.throws(() => checkLog(output, 'a'.repeat(64))));
test('canonical JSON recursively sorts keys, preserves array order', () => assert.equal(canonical({ z:[{b:1,a:2}], a:true }), '{"a":true,"z":[{"a":2,"b":1}]}'));
const build = 'd'.repeat(64);
const a = { project_id:'keyhole-devmo.near/keyhole', executed_wasm_sha256:build, wasm_hash:build, tdx_quote:'a'.repeat(200), output_hash:sha(canonical(output)) };
test('attestation checks exact bytes and expected build', () => assert.doesNotThrow(() => checkAttestation(a, { build, output })));
for (const [name, patch] of [
  ['wrong project', { project_id:'wrong' }],
  ['wrong registered build', { wasm_hash:'f'.repeat(64) }],
  ['absent quote', { tdx_quote:null }],
  ['edited output hash', { output_hash:'f'.repeat(64) }],
]) test(`attestation rejects ${name}`, () => assert.throws(() => checkAttestation({ ...a, ...patch }, { build, output })));
test('attestation rejects an unexpected executed build even if internally consistent', () => assert.throws(() => checkAttestation(a, { build:'c'.repeat(64) })));
