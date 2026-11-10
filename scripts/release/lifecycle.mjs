// Checkpoints are evidence capsules, never trusted success flags. Production
// verification re-fetches their canonical block, chain views and attestations.
import {ACCOUNT,CANDIDATE,WORKER,canonical,sha,requireThat as must} from './promotion-lib.mjs';
export const PHASES=['predeploy','deploy-post','restore','provision-pre','provision-post','pilot-post'];
export const PREVIOUS={restore:'deploy-post','provision-pre':'restore','provision-post':'provision-pre','pilot-post':'provision-post'};
export const seconds=b=>Number(BigInt(b.timestamp)/1000000000n);
export function subject(e,ctx,offered=false){const p=e.prepare?.output,m=JSON.parse(e.prepare.input.auth.message);return {contract:ACCOUNT,network:ctx.pledge.network,token_id:p.token_id,owner:m.account_id,owner_epoch:p.owner_epoch,wallet_pubkey:p.wallet_pubkey,policy_hash:p.policy_hash,policy_version:String(p.version),provision_id:p.provision_id,loan_nonce:offered?ctx.freeze_loan.nonce:String(BigInt(ctx.pledge.next_loan_nonce)+1n),terms:e.pilot_approval.payload.subject.terms};}
export function approvedSubject(e,ctx,offered=false){const target=subject(e,ctx,offered);must(canonical(target)===canonical(e.pilot_approval?.payload.subject),'pilot approval does not bind exact subject/terms/nonce');must(target.token_id===ctx.token.token_id&&target.owner===ctx.token.owner_id&&target.owner_epoch===ctx.control.owner_epoch&&target.network==='mainnet','pilot subject/control mismatch');return target;}
export function makeCheckpoint(phase,e,ctx){must(PHASES.includes(phase)&&ctx.snapshot?.block,'checkpoint phase/block required');return {schema:'keyhole-release-checkpoint-v1',phase,release:{account:ACCOUNT,contract:CANDIDATE,worker:WORKER},block:ctx.snapshot.block,snapshot_sha256:sha(canonical(ctx.snapshot)),evidence:structuredClone(e)};}
export async function verifyCheckpoint(cp,expected,trust,call,net){
 must(cp?.schema==='keyhole-release-checkpoint-v1'&&cp.phase===expected&&PHASES.includes(expected),'wrong checkpoint phase');must(canonical(cp.release)===canonical({account:ACCOUNT,contract:CANDIDATE,worker:WORKER}),'checkpoint release mismatch');
 const final=await call('block',{finality:'final'}),header=(await call('block',{block_id:cp.block.height})).header;must(header.hash===cp.block.hash&&header.height<=final.header.height,'checkpoint not canonical finalized');
 const {context,workerPublication}=await import('./promote-v26.mjs');const {releaseGates}=await import('./gates.mjs');const ctx=await context(cp.evidence,call,net,{phase:expected,block:cp.block.hash,historical:true});must(canonical(ctx.snapshot.block)===canonical(cp.block)&&sha(canonical(ctx.snapshot))===cp.snapshot_sha256,'checkpoint differs from original chain');
 const result=await releaseGates(cp.evidence,trust,ctx);must(result.phase_ready,'original checkpoint gates failed');if(expected==='restore')await workerPublication(cp.evidence,trust,call,net,{context:ctx});return {ctx,evidence:cp.evidence,block:cp.block,phase:expected};
}
