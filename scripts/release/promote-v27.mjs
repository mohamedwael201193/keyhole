// Read-only evidence promotion. No deploy, signer, key, governance or worker changes.
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {rpc,sha,b58,canonical,requireThat as must} from './promotion-lib.mjs';
export const HASH='26d3deeff8a4445515d6356097bd7634e8b26deaee7e7ea1ebe47849b807c08c';
export const TX='6rD2iMs146L3H3ghKTGwhcXtAmNQCGU2P3C7nx1ewi2h';
const ACCOUNT='keyhole-devmo.near';
export async function captureV27(call=rpc, blockId) {
 const block=await call('block',blockId?{block_id:blockId}:{finality:'final'});
 if(blockId)must(block.header.hash===blockId,'wrong evidence block');
 const query=p=>call('query',{account_id:ACCOUNT,block_id:block.header.hash,...p});
 const view=async method=>JSON.parse(Buffer.from((await query({request_type:'call_function',method_name:method,args_base64:'e30='})).result));
 const account=await query({request_type:'view_account'});
 must(account.block_hash===block.header.hash && account.block_height===block.header.height,'inconsistent account block');
 const code=Buffer.from((await query({request_type:'view_code'})).code_base64,'base64');
 return {schema:'KEYHOLE_V27_EVIDENCE_V1',block:{hash:block.header.hash,height:block.header.height},account,code:{sha256:sha(code),bytes:code.length},metadata:await view('contract_source_metadata'),config:await view('config'),pledge:await view('get_pledge_config'),deployment:await call('tx',{tx_hash:TX,sender_account_id:ACCOUNT,wait_until:'FINAL'})};
}
export function validateV27(id,e,artifact) {
 must(e.schema==='KEYHOLE_V27_EVIDENCE_V1','wrong evidence schema');
 must(sha(artifact)===HASH && artifact.length===519382,'release bytes mismatch');
 must(e.code.sha256===HASH && e.code.bytes===artifact.length && e.account.code_hash===b58(Buffer.from(HASH,'hex')),'live bytes/hash mismatch');
 must(e.metadata.version==='2.7.0','live version mismatch');
 must(e.config.minter===id.contract.minter && e.config.owner===ACCOUNT && e.config.treasury===ACCOUNT && e.config.royalty_bps===500,'config authority mismatch');
 must(e.pledge.attestor_public_key===Buffer.from(id.contract.minter,'hex').toString('base64') && e.pledge.recovery_account===id.contract.recovery_account && e.pledge.custody_contract==='outlayer.near' && e.pledge.network==='mainnet' && e.pledge.lending_enabled===false,'pledge authority/state mismatch');
 const t=e.deployment,tx=t.transaction;
 must(t.final_execution_status==='FINAL' && t.status?.SuccessValue==='' && tx.hash===TX && tx.signer_id===ACCOUNT && tx.receiver_id===ACCOUNT,'not genuine FINAL self deployment');
 must(tx.actions.length===1 && tx.actions[0].DeployContract && Buffer.from(tx.actions[0].DeployContract.code,'base64').equals(Buffer.from(HASH,'hex')),'deployment action hash mismatch');
 must(t.transaction_outcome?.id===TX && Array.isArray(t.receipts_outcome) && t.receipts_outcome.length>0,'missing receipt lineage');
 const outcomes=[t.transaction_outcome,...t.receipts_outcome];
 const ids=new Set(outcomes.map(r=>r.id));
 for(const r of outcomes) {
  const s=r.outcome?.status;
  must(s && !s.Failure && (typeof s.SuccessValue==='string' || typeof s.SuccessReceiptId==='string'),'non-successful outcome');
  must(Array.isArray(r.outcome.receipt_ids) && r.outcome.receipt_ids.every(x=>ids.has(x)),'incomplete receipt lineage');
  if(s.SuccessReceiptId)must(ids.has(s.SuccessReceiptId),'missing success receipt');
 }
 const historical=[...(id.contract.historical_deployments??[])];
 if(id.contract.deploy_tx!==TX && !historical.some(x=>x.deploy_tx===id.contract.deploy_tx))historical.push({...id.contract,historical_deployments:undefined});
 return {...id.contract,version:'2.7.0',bytes:artifact.length,wasm_sha256:HASH,code_hash:e.account.code_hash,deploy_tx:TX,historical_deployments:historical};
}
export async function promoteV27(id,e,root,call=rpc) {
 const fresh=await captureV27(call,e.block.hash);
 must(canonical(e)===canonical(fresh),'public evidence differs from RPC');
 const final=await call('block',{finality:'final'});
 must(final.header.height>=e.block.height,'evidence block not FINAL');
 return validateV27(id,e,readFileSync(root+'contracts/keys/release/v2.7/keyhole_keys.wasm'));
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const e=await captureV27();
 writeFileSync(process.argv[2],JSON.stringify(e,null,2)+'\n');
}
