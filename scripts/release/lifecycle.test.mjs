import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sequenceFixture} from './sequence-fixture.mjs';
import {fixtures,clone} from './fixtures.mjs';
import {PHASES,verifyCheckpoint} from './lifecycle.mjs';
import {releaseGates,restoreProbe,certificateBytes} from './gates.mjs';
import {context,workerPublication} from './promote-v26.mjs';
import {canonical,sha} from './promotion-lib.mjs';
const failures=g=>g.rows.filter(r=>r.status!=='PASS');
test('real-shaped sequential RPC collector: predeploy, code-only post, publication/restore, prepare, provision, genuine Offered',async()=>{
 const f=await sequenceFixture();
 for(const phase of PHASES){const {e,ctx}=f.at(phase);const g=await releaseGates(e,f.trust,ctx);assert.deepEqual(failures(g),[],phase);assert.equal(g.phase_ready,true);assert.equal(g.all_mainnet_ready,phase==='pilot-post');}
 const idle=f.at('provision-post'),offered=f.at('pilot-post');assert.equal(idle.ctx.control.pledged,false);assert.equal(idle.ctx.freeze_loan,undefined);assert.equal(offered.ctx.control.pledged,true);
 await assert.rejects(restoreProbe(offered.e.restore,offered.ctx));
 assert.equal((await releaseGates(offered.e,f.trust,{...offered.ctx,phase:'all'})).ready,true);
});
test('positive workerPublication collector verifies original three batches, singleton source, actual wasm, secret refund and guarded smoke',async()=>{
 const f=await sequenceFixture(),{e}=f.at('restore');f.setCurrent(120);const result=await workerPublication(e,f.trust,f.call,f.net);assert.equal(result.publication_tx,'publish1');assert.equal(result.ctx.control.pledged,false);
 f.txs.get('publish2').transaction.actions.pop();await assert.rejects(workerPublication(e,f.trust,f.call,f.net));
});
test('predeploy can honestly pass without any future transaction, policy, quote, eligibility or certificate evidence',async()=>{
 const f=fixtures('predeploy'),{maintenance,approval,pause_acknowledgements,barrier_observation}=f.e;
 const g=await releaseGates({maintenance,approval,pause_acknowledgements,barrier_observation},f.trust,f.ctx);assert.deepEqual(failures(g),[]);assert.equal(g.ready_deploy,true);assert.equal(g.all_mainnet_ready,false);assert.equal(g.rows.length,2);
});
for(const field of ['token_id','wallet_pubkey','owner_epoch','policy_hash','policy_version','terms','network','contract'])test('individually measured foreign certificate fails exact pilot binding: '+field,async()=>{
 const f=fixtures(),c=f.e.certificate.output.certificate;
 // Re-issue a genuinely signed independent fixture certificate, not just a bad signature.
 c[field]=field==='terms'?{...c.terms,principal:'123'}:field==='policy_hash'?Buffer.alloc(32,1).toString('base64'):['owner_epoch','policy_version'].includes(field)?'99':field==='wallet_pubkey'?'ed25519:'+'a'.repeat(64):'foreign';
 f.ctx.certificate_template=clone(c);f.e.certificate.output.signature=f.attestor.sign(certificateBytes(c)).toString("base64");
 const g=await releaseGates(f.e,f.trust,f.ctx);assert.equal(g.phase_ready,false);assert.equal(g.rows.find(r=>r.name==='genuine_freeze_and_attestor_continuity').status,'FAIL');
});
test('independent internally valid freeze bundle cannot satisfy another prepared token and wallet',async()=>{
 const f=fixtures(),e=f.e,other='prepared-but-never-frozen',wallet='ed25519:'+'a'.repeat(64);
 for(const key of ['prepare','quote','install','provision','restore','inventory']){const r=e[key],m=JSON.parse(r.input.auth.message);if(m.params.token_id)m.params.token_id=other;r.input.auth.message=JSON.stringify(m);if(r.output.token_id)r.output.token_id=other;if(r.output.wallet_pubkey)r.output.wallet_pubkey=wallet;}
 e.pilot_approval=f.approve('pilot-budget',{...e.pilot_approval.payload,subject:{...e.pilot_approval.payload.subject,token_id:other,wallet_pubkey:wallet}});
 f.ctx.token.token_id=other;f.ctx.control.token_id=other;f.ctx.control.pledged=false;f.ctx.binding.wallet_pubkey=wallet;f.ctx.lower_policy.frozen=false;
 // Keep the complete independent original Offered loan and immutable-attestor certificate unchanged.
 const g=await releaseGates(e,f.trust,f.ctx);assert.equal(g.phase_ready,false);assert.equal(g.rows.find(r=>r.name==='genuine_freeze_and_attestor_continuity').status,'FAIL');
});
for(const change of ['foreign-block','wrong-time','wrong-phase','future-checkpoint','foreign-subject','changed-snapshot','missing-original'])test('reject historical checkpoint/certificate replay: '+change,async()=>{
 const f=await sequenceFixture(),v=f.at('pilot-post'),cp=v.e.checkpoints['provision-post'];
 if(change==='foreign-block')v.e.certificate.block.hash='foreign';
 if(change==='wrong-time')v.ctx.certificate_block.timestamp=String(BigInt(v.ctx.certificate_block.timestamp)+1000000n);
 if(change==='wrong-phase')cp.phase='restore';
 if(change==='future-checkpoint')cp.block.height=151;
 if(change==='foreign-subject')cp.evidence.prepare.output.token_id='foreign';
 if(change==='changed-snapshot')cp.snapshot_sha256='0'.repeat(64);
 if(change==='missing-original')delete cp.evidence.restore;
 assert.equal((await releaseGates(v.e,f.trust,v.ctx)).phase_ready,false);
});
test('collector fails foreign token before accepting a separate valid loan/certificate graph',async()=>{
 const f=await sequenceFixture(),{e}=f.at('pilot-post');e.freeze.token_id='another-token';await assert.rejects(context(e,f.call,f.net,{phase:'pilot-post'}));
});
test('archived idle phase re-fetches actual canonical state and original measured rows, never a caller PASS',async()=>{
 const f=await sequenceFixture();await assert.rejects(verifyCheckpoint({phase:'provision-post',ready:true},'provision-post',f.trust,f.call,f.net));
 const cp=clone(f.caps['provision-post']);f.snaps.get(cp.block.hash).controls[0].owner_epoch='99';await assert.rejects(verifyCheckpoint(cp,'provision-post',f.trust,f.call,f.net));
});
test('checkpoint cannot swap an equally signed alternative approved pilot subject',async()=>{
 const f=fixtures(),cp=f.e.checkpoints['provision-post'];cp.evidence.pilot_approval=f.approve('pilot-budget',{...cp.evidence.pilot_approval.payload,subject:{...cp.evidence.pilot_approval.payload.subject,token_id:'another-token'}});assert.equal((await releaseGates(f.e,f.trust,f.ctx)).phase_ready,false);
});
