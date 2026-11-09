#!/usr/bin/env node
// Public, read-only README acceptance path. Node 20+, no npm install or secrets.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, verify } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));
const identity = read('identity.json');
const SITE = 'https://keyhole-seven.vercel.app';
const API = 'https://api.outlayer.ai';
const TOKEN = 'k5f4750858f328940';
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function checkLog(doc, expectedMinter) {
  assert.equal(doc.ok, true, 'provenance output must be successful');
  assert.equal(doc.token_id, TOKEN, 'token binding');
  assert.match(doc.minter, /^[0-9a-f]{64}$/, 'minter shape');
  if (expectedMinter) assert.equal(doc.minter, expectedMinter, 'signer equals current contract minter');
  assert.match(doc.sig, /^[0-9a-f]{128}$/, 'signature required');
  assert.match(doc.head, /^[0-9a-f]{64}$/, 'head required');
  assert.ok(Array.isArray(doc.events) && doc.events.length > 0, 'non-empty log required');
  let head = '0'.repeat(64), swaps = 0;
  for (const [i, ev] of doc.events.entries()) {
    assert.equal(ev.i, i, 'contiguous event index');
    assert.equal(ev.prev, head, 'previous event hash');
    assert.match(ev.detail_hash, /^[0-9a-f]{64}$/);
    assert.ok(Number.isSafeInteger(ev.ts_ms) && ev.ts_ms >= 0);
    if (ev.detail != null) assert.equal(sha(ev.detail), ev.detail_hash, 'private detail commitment');
    const bytes = canonical({ detail_hash: ev.detail_hash, i, kind: ev.kind, owner: ev.owner, prev: ev.prev, token_id: TOKEN, ts_ms: ev.ts_ms });
    head = sha(bytes);
    assert.equal(ev.hash, head, 'published event hash');
    if (ev.kind === 'swap') swaps++;
  }
  assert.equal(head, doc.head, 'signed log head');
  assert.ok(swaps > 0, 'log contains swap events');
  const pub = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(doc.minter, 'hex')]);
  assert.ok(verify(null, Buffer.from(head), { key: pub, format: 'der', type: 'spki' }, Buffer.from(doc.sig, 'hex')), 'ed25519 signature');
  return { events: doc.events.length, swaps, head };
}
export function checkAttestation(a, { build, output, project = identity.worker.project } = {}) {
  assert.equal(a.project_id, project, 'attested project');
  assert.match(a.executed_wasm_sha256, /^[0-9a-f]{64}$/);
  assert.equal(a.wasm_hash, a.executed_wasm_sha256, 'registered/executed wasm binding');
  if (build) assert.equal(a.executed_wasm_sha256, build, 'expected worker build');
  assert.ok(typeof a.tdx_quote === 'string' && a.tdx_quote.length > 100, 'TDX quote present');
  if (output !== undefined) assert.equal(sha(canonical(output)), a.output_hash, 'exact canonical output commitment');
}
async function request(url, options = {}) {
  let error;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
      if (r.status !== 429 && r.status < 500) return r;
      error = new Error(`HTTP ${r.status} from ${url}`);
    } catch (e) { error = e; }
    if (i < 2) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
  }
  throw error;
}
async function json(url, options) {
  const r = await request(url, options);
  assert.ok(r.ok, `HTTP ${r.status} from ${url}`);
  return r.json();
}
async function rpc(params) {
  let error;
  for (const url of ['https://rpc.mainnet.fastnear.com', 'https://rpc.mainnet.near.org']) {
    try {
      const j = await json(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params }) });
      assert.ok(!j.error && j.result, `RPC query: ${JSON.stringify(j.error)}`);
      return j.result;
    } catch (e) { error = e; }
  }
  throw error;
}
const query = (request_type, extra = {}) => rpc({ request_type, finality: 'final', account_id: identity.contract.account, ...extra });
const view = async (method_name, args = {}) => JSON.parse(Buffer.from((await query('call_function', { method_name, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') })).result).toString());
const att = async call => { assert.match(call, /^[0-9a-f-]{36}$/); return json(`${API}/attestations/by-call/${call}`); };

export async function main(args = []) {
  assert.ok(args.every(x => x === '--offline'), 'usage: node judge/readme-verify.mjs [--offline]');
  const offline = args.includes('--offline');
  const sum = sha(readFileSync(resolve(ROOT, 'contracts/keys/deployed/keyhole_keys.wasm')));
  assert.equal(sum, identity.contract.wasm_sha256);
  assert.equal(readFileSync(resolve(ROOT, 'tee/worker/DEPLOYED_SHA256'), 'utf8').trim(), identity.worker.wasm_sha256);
  console.log(`PASS local release identities: contract ${sum}, worker ${identity.worker.wasm_sha256}`);
  const fixture = read('docs/evidence/readme-verification/public-log.json');
  const log = checkLog(fixture.output);
  console.log(`PASS recorded signed swap log: ${log.events} events, ${log.swaps} swaps, head ${log.head}`);
  const changed = structuredClone(fixture.output);
  changed.events[0].owner = 'attacker.near';
  assert.throws(() => checkLog(changed));
  console.log('PASS mutation: edited log owner rejected');
  const rows = read('judge/evidence.json');
  const refused = rows.filter(row => row.output.error?.code);
  assert.ok(refused.length > 0);
  console.log(`PASS recorded refusal fixtures: ${refused.length} expected error codes`);
  if (offline) {
    console.log('SKIP public RPC, attestation API, FastFS, fresh provenance and gateway probes (--offline)');
    return;
  }
  const account = await query('view_account');
  assert.equal(account.code_hash, identity.contract.code_hash);
  const [cfg, metadata, supply, key] = await Promise.all([view('config'), view('contract_source_metadata'), view('nft_total_supply'), view('nft_token', { token_id: TOKEN })]);
  assert.equal(metadata.version, '2.4.0');
  assert.equal(key.token_id, TOKEN);
  assert.ok(BigInt(supply) >= 1n);
  console.log(`PASS mainnet code_hash ${account.code_hash}`);
  console.log(`PASS mainnet views: version ${metadata.version}, supply ${supply}, token ${key.token_id}, owner ${key.owner_id}, minter ${cfg.minter}`);
  const permissions = await query('view_access_key_list');
  const full = permissions.keys.filter(k => k.access_key.permission === 'FullAccess').length;
  const scoped = permissions.keys.filter(k => k.access_key.permission?.FunctionCall).length;
  console.log(`PASS current contract authority inventory: ${full} FullAccess, ${scoped} FunctionCall (public RPC)`);
  const a = await att(identity.worker.info_call);
  checkAttestation(a, { build: identity.worker.wasm_sha256 });
  const wasm = await request(`https://main.fastfs.io/${identity.contract.account}/outlayer.near/${identity.worker.wasm_sha256}.wasm`);
  assert.ok(wasm.ok);
  const bytes = Buffer.from(await wasm.arrayBuffer());
  assert.equal(bytes.length, identity.worker.bytes);
  assert.equal(sha(bytes), identity.worker.wasm_sha256);
  console.log(`PASS published worker bytes: ${bytes.length}, sha256 ${sha(bytes)} (matches recorded info attestation; quote present)`);
  for (const row of refused) {
    const proof = await att(row.call_id);
    checkAttestation(proof, { output: row.output });
    console.log(`PASS recorded refusal ${row.output.error.code}: ${row.call_id}, build ${proof.executed_wasm_sha256.slice(0, 8)}, exact output hash`);
  }
  const fresh = await json(`${SITE}/api/worker`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'provenance', token_id: TOKEN }) });
  const live = checkLog(fresh.output, cfg.minter);
  checkAttestation(await att(fresh.call_id), { build: identity.worker.wasm_sha256, output: fresh.output });
  console.log(`PASS fresh public signed swap log: ${live.events} events, ${live.swaps} swaps, minter matches mainnet, output bound to ${fresh.call_id}`);
  for (const [body, status, code] of [
    [JSON.stringify({ op: 'copy' }), 400, 'bad_op'],
    [JSON.stringify({ op: 'info', pad: 'x'.repeat(9000) }), 413, null],
  ]) {
    const r = await request(`${SITE}/api/worker`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(r.status, status, 'fresh gateway refusal HTTP status');
    const response = await r.json();
    if (code) assert.equal(response.error?.code, code);
    console.log(`PASS fresh gateway refusal: HTTP ${status}${code ? ' ' + code : ' oversized body'} (not an enclave attack)`);
  }
  for (const page of ['/verify', '/attack', '/judge']) {
    const r = await request(SITE + page);
    assert.equal(r.status, 200);
    console.log(`PASS live proof page ${page}: HTTP 200`);
  }
  console.log('PASS README public verification complete; no wallet, secrets or value-moving operations');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => { console.error(`FAIL ${e.message}`); process.exitCode = 1; });
}
