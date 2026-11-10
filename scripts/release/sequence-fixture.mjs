// Local-only synthetic RPC/HTTPS boundary for the complete real-shaped lifecycle.
// All signatures use ephemeral fixture keys; never contacts a public endpoint.
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {fixtures,clone,graph} from './fixtures.mjs';
import {PHASES,makeCheckpoint} from './lifecycle.mjs';
import {ACCOUNT,CANDIDATE,WORKER,b58,sha,canonical} from './promotion-lib.mjs';
import {context} from './promote-v26.mjs';
const root=new URL('../../',import.meta.url);
export async function sequenceFixture(){
 const f=fixtures(),base=clone(f.e),now=f.ctx.now;
 const plan=JSON.parse(readFileSync(new URL('docs/evidence/worker-provisioning/publish-plan.json',root)));
 const original=JSON.parse(readFileSync(new URL('docs/evidence/worker-provisioning/r3/before.json',root)));
 const snaps=new Map(),blocks=new Map(),txs=new Map(),bodies=new Map(),stages=new Map(),caps={},rows=new Map();
 const block=h=>({height:h,hash:'sequence-block-'+h,timestamp:String(BigInt(now-150+h)*1000000000n)});
 for(let h=95;h<=150;h++){const b=block(h);blocks.set(h,b);blocks.set(b.hash,b);}
 const minter=f.ctx.snapshot.config.minter;
 base.quote.output.storage_refund_to=minter;
 base.secret_merge={hash:f.ctx.secret_merge.hash};
 const secret=f.ctx.secret_merge;
 for(const r of secret.receipts)bodies.set(r.receipt_id,r);
 const secretTx=clone(secret.tx);secretTx.receipts_outcome[0].id='secret-r';secretTx.transaction_outcome.outcome.receipt_ids=['secret-r'];secretTx.transaction_outcome.outcome.status={SuccessReceiptId:'secret-r'};for(const n of [secretTx.transaction_outcome,...secretTx.receipts_outcome])n.block_hash=block(114).hash;
 bodies.set('secret-r',{receipt_id:'secret-r',receiver_id:'outlayer.near',predecessor_id:ACCOUNT,receipt:{Action:{actions:clone(secretTx.transaction.actions)}}});txs.set(secret.hash,secretTx);
 const frozen=clone(base.freeze.tx);frozen.receipts_outcome[0].id='freeze-r';frozen.transaction_outcome.outcome.receipt_ids=['freeze-r'];frozen.transaction_outcome.outcome.status={SuccessReceiptId:'freeze-r'};bodies.set('freeze-r',{receipt_id:'freeze-r',receiver_id:ACCOUNT,predecessor_id:'alice.near',receipt:{Action:{actions:clone(frozen.transaction.actions)}}});for(const [i,n] of [frozen.transaction_outcome,...frozen.receipts_outcome].entries())n.block_hash=block(145+Math.min(i,1)).hash;
 txs.set(base.freeze.hash,frozen);base.freeze.signer_id='alice.near';
 for(const r of f.ctx.freeze_receipts)bodies.set(r.receipt_id,r);
 const secretRaw={storage_deposit:secret.row.storage_deposit,accessor:secret.row.accessor,access:secret.row.access,encrypted_secrets:JSON.parse(Buffer.from(secret.tx.transaction.actions[0].FunctionCall.args,'base64')).encrypted_secrets_base64};
 const old=plan.retired.map(wasm_hash=>({wasm_hash,is_active:wasm_hash===plan.previous_active}));
 base.publication={before_block:block(112).hash,hashes:['publish1','publish2','publish3']};
 base.publication_approval=f.approve('worker-publication',{...base.publication_approval.payload,registry_before_sha256:sha(canonical(old))});
 let offset=0;
 for(const [i,hash] of base.publication.hashes.entries()){
  const tx=graph(hash,'outlayer.near'),actions=[];
  if(i===0)actions.push({FunctionCall:{method_name:'add_version',deposit:plan.version_deposit_yocto,args:Buffer.from(JSON.stringify({project_name:'keyhole',set_active:true,source:{WasmUrl:{url:plan.url,hash:WORKER,build_target:'wasm32-wasip2'}}})).toString('base64')}});
  while(actions.length<[5,9,9][i])actions.push({FunctionCall:{method_name:'remove_version',deposit:'0',args:Buffer.from(JSON.stringify({project_name:'keyhole',version_key:plan.retired[offset++]})).toString('base64')}});
  tx.transaction.actions=actions;for(const n of [tx.transaction_outcome,...tx.receipts_outcome])n.block_hash=block(115+i).hash;txs.set(hash,tx);
 }
 for(const [i,phase] of PHASES.entries()){
  const s=clone(original),isBefore=phase==='predeploy';s.block=block(100+i*10);
  s.tokens[0]={...s.tokens[0],token_id:'pilot',owner_id:'alice.near'};s.controls[0]={...s.controls[0],token_id:'pilot',owner_epoch:'3',pledged:phase==='pilot-post'};
  s.config.minter=minter;s.pledge={...s.pledge,...f.ctx.pledge,next_loan_nonce:phase==='pilot-post'?'5':'4',lending_enabled:phase==='pilot-post'};
  s.credits=[...new Set([...s.tokens.map(t=>t.owner_id),minter,s.config.treasury,s.pledge.recovery_account])].sort().map(account=>({account,available:'0',pending:null}));
  if(!isBefore){s.code={sha256:CANDIDATE,bytes:487260};s.source.version='2.6.0';s.account.code_hash=b58(Buffer.from(CANDIDATE,'hex'));s.account.storage_usage+=1405;}
  s.account.block_hash=s.block.hash;s.account.block_height=s.block.height;snaps.set(s.block.hash,s);
 }
 const deploy=graph('sequence-deploy');deploy.transaction.actions=[{DeployContract:{code:readFileSync(new URL('contracts/keys/release/v2.6/keyhole_keys.wasm',root)).toString('base64')}}];for(const n of [deploy.transaction_outcome,...deploy.receipts_outcome])n.block_hash=block(105).hash;txs.set('sequence-deploy',deploy);
 base.contract_post={schema:'keyhole-v26-code-only-post-v1',before:snaps.get(block(100).hash),after:snaps.get(block(110).hash),deploy_hash:'sequence-deploy',deploy};
 base.approval=f.approve('deploy-code-only-v26',{...base.approval.payload,before_state_sha256:sha(canonical(snaps.get(block(100).hash))),protocol_config_sha256:sha(canonical({runtime_config:{storage_amount_per_byte:'10000000000000000000'}}))});
 base.certificate.block=block(150);
 const postRestore=clone(base.restore),postInventory=clone(base.inventory);postRestore.call_id='00000000-0000-0000-0000-000000000101';postInventory.call_id='00000000-0000-0000-0000-000000000102';
 const stamps=new Map();for(const [name,r] of Object.entries(base).filter(([,r])=>r?.call_id))stamps.set(r.call_id,now-({info:30,restore:30,prepare:20,quote:20,inventory:20,install:12,provision:12,certificate:0}[name]));
 stamps.set(postRestore.call_id,now-10);stamps.set(postInventory.call_id,now-10);

 for(const r of Object.values(base).filter(r=>r?.call_id))rows.set(r.call_id,r);
 let current=100;
 const call=async(method,p)=>{
  if(method==='block'){const b=p.finality?block(current):blocks.get(p.block_id);if(!b)throw Error('unknown fixture block');return{header:b};}
  if(method==='tx'){if(!txs.has(p.tx_hash))throw Error('unknown original tx');return clone(txs.get(p.tx_hash));}
  if(method==='EXPERIMENTAL_receipt'){if(!bodies.has(p.receipt_id))throw Error('unknown receipt');return clone(bodies.get(p.receipt_id));}
  if(method==='gas_price')return{gas_price:f.ctx.gas_price};
  if(method==='EXPERIMENTAL_protocol_config')return{runtime_config:{storage_amount_per_byte:'10000000000000000000'}};
  if(method!=='query')throw Error('unexpected RPC (no transaction writes allowed)');
  const b=blocks.get(p.block_id),s=snaps.get(p.block_id)||snaps.get(block(b.height<110?100:110).hash);
  if(p.request_type==='view_account')return p.account_id===ACCOUNT?clone(s.account):{amount:String(10n**24n),storage_usage:0};
  if(p.request_type==='view_code')return{code_base64:readFileSync(new URL('contracts/keys/release/'+(s.code.sha256===CANDIDATE?'v2.6':'v2.5')+'/keyhole_keys.wasm',root)).toString('base64')};
  if(p.request_type==='view_state')return{values:clone(s.state)};
  const a=JSON.parse(Buffer.from(p.args_base64,'base64')),pilot=b.height>=145;
  const views={nft_tokens:s.tokens,nft_total_supply:'6',config:s.config,get_pledge_config:s.pledge,nft_metadata:s.metadata,contract_source_metadata:s.source,get_control_state:s.controls.find(c=>c.token_id===a.token_id),get_payout_credit:'0',get_pending_payout:null,get_project:{...f.ctx.registry,active_version:b.height<=112?plan.previous_active:WORKER},list_versions:b.height<=112?old:f.ctx.registry.versions,get_version_count:b.height<=112?22:1,get_secrets:secretRaw,get_collateral_binding:b.height<=130?null:(pilot?f.ctx.freeze_binding:f.ctx.binding),get_wallet_policy:{...f.ctx.lower_policy,frozen:pilot},get_loan:pilot?f.ctx.freeze_loan:null,loan_certificate_template:f.ctx.certificate_template};
  if(!Object.hasOwn(views,p.method_name))throw Error('unexpected view '+p.method_name);return{result:[...Buffer.from(JSON.stringify(views[p.method_name]))]};
 };
 const net=async(url,opts)=>{
  if(url.endsWith('/api/keyhole')||url.endsWith('/api/worker'))return new Response('',{status:503,headers:{'cache-control':'no-store'}});
  if(url.includes('/balance'))return Response.json({owner:ACCOUNT,nonce:1,available:514657,reserved:0});
  if(url===plan.url)return new Response(gunzipSync(readFileSync(new URL('./fixtures/worker-candidate.wasm.gz',import.meta.url))));
  if(url.includes('/attestations/by-call/')){const id=url.split('/').pop(),r=rows.get(id);if(!r)throw Error('unknown attestation');return Response.json({call_id:id,project_id:ACCOUNT+'/keyhole',wasm_hash:WORKER,executed_wasm_sha256:WORKER,timestamp:stamps.get(id),tdx_quote:'synthetic-quote'.repeat(20),worker_measurement:'0'.repeat(96),input_hash:sha(canonical(r.input)),output_hash:sha(canonical(r.output))});}
  throw Error('unexpected HTTPS target');
 };
 for(const phase of PHASES){current=100+10*PHASES.indexOf(phase);const e=clone(base);e.checkpoints=clone(caps);
  const index=PHASES.indexOf(phase);if(index<5){delete e.freeze;delete e.certificate;}if(index<4){delete e.install;delete e.provision;}if(index<3){for(const k of ['prepare','quote','inventory','pilot_approval','audit'])delete e[k];}if(index<2){for(const k of ['secret_merge','publication','publication_approval','restore','info'])delete e[k];}if(index===0)delete e.contract_post;
  if(index>=4){e.restore=clone(postRestore);e.inventory=clone(postInventory);}
  e.compute_ledger=[...new Map([...base.compute_ledger.filter(r=>stamps.get(r.call_id)<=now-150+current),...[postRestore,postInventory].filter(r=>stamps.get(r.call_id)<=now-150+current).map(r=>({call_id:r.call_id,op:r.input.op,limit_micro_usd:10000,status:'SUCCESS'}))].map(r=>[r.call_id,r])).values()];
  for(const r of Object.values(e).filter(r=>r?.call_id))rows.set(r.call_id,r);
  const ctx=await context(e,call,net,{phase,block:block(current).hash,historical:true});const result={e,ctx};stages.set(phase,result);caps[phase]=makeCheckpoint(phase,e,ctx);
 }
 current=150;
 return{...f,stages,caps,call,net,blocks,snaps,rows,txs,at:phase=>stages.get(phase),setCurrent:h=>current=h};
}
