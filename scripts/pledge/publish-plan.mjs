// READ-ONLY planner: emits an unsigned near-cli command; never runs it, reads
// credentials, calls /call or broadcasts. Refresh public registry before use.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function planPublish(hash, versions) {
  if (!/^[a-f0-9]{64}$/.test(hash) || !Array.isArray(versions) || versions.length !== 22) throw new Error('expected reviewed 22-version snapshot');
  const old = versions.map(v => v.wasm_hash);
  if (new Set(old).size !== old.length || old.some(h => !/^[a-f0-9]{64}$/.test(h) || h === hash)) throw new Error('invalid/duplicate/new hash in retirement list');
  const url = `https://main.fastfs.io/keyhole-devmo.near/outlayer.near/${hash}.wasm`;
  const source = { WasmUrl: { url, hash, build_target: 'wasm32-wasip2' } };
  const bytes = 150 + Buffer.byteLength(url) + 64 + 13 + 64 + 8 + 16;
  const deposit = (BigInt(bytes) * 10000000000000000000n).toString();
  const action = (method, args, gas, amount='0') => ['add-action', 'function-call', method, 'json-args', JSON.stringify(args), 'prepaid-gas', `${gas} Tgas`, 'attached-deposit', `${amount} yoctoNEAR`];
  const batches = [
    [...action('add_version', { project_name:'keyhole', source, set_active:true }, 100, deposit), ...old.slice(0,4).flatMap(h=>action('remove_version',{project_name:'keyhole',version_key:h},30))],
    old.slice(4,13).flatMap(h=>action('remove_version',{project_name:'keyhole',version_key:h},30)),
    old.slice(13).flatMap(h=>action('remove_version',{project_name:'keyhole',version_key:h},30)),
  ];
  const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
  return {hash,url,version_storage_bytes:bytes,version_deposit_yocto:deposit,retired:old,
    registry_batches:batches.map((actions,i)=>({gas_tgas:[220,270,270][i],command:['near','transaction','construct-transaction','keyhole-devmo.near','receiver-id','outlayer.near',...actions,'skip','network-config','mainnet','sign-with-keychain','send'].map(quote).join(' ')})),
    configured_gas_tgas_including_secret_merge:810,
    note:'Unsigned templates only. Owner separately approves exact snapshot/actions. Each original transaction must be FINAL, all receipts/refunds checked before next batch. UNKNOWN stops; never split or resend a declined batch.'};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const id=JSON.parse(readFileSync('identity.json','utf8'));
  const snapshot=JSON.parse(readFileSync('docs/evidence/worker-provisioning/public-pricing.json','utf8'));
  const vs=snapshot.views.find(v=>v.method==='list_versions').value;
  console.log(JSON.stringify(planPublish(id.worker_candidate.wasm_sha256,vs),null,2));
}
