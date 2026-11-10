// OFFLINE ONLY. Pinned official v0.2.2 FastFS Borsh wire format; never signs/sends.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
export const CHUNK=1<<20;
export const MAX_NONCE=0x7fffffff;
// FastFS PartialFastfs::is_valid requires a nonzero signed-32-bit nonce.
export function validateNonce(n) {
 if(!Number.isInteger(n)||n<1||n>MAX_NONCE)throw Error('FastFS nonce must be an integer in 1..2147483647');
 return n;
}
// A persisted previous *indexed* nonce prevents collisions within a second or
// after the seconds counter wraps. Invalid/unindexed historical batches are
// not storage competitors. Exhaustion fails closed rather than reusing a nonce.
export function deriveNonce(seconds=Math.floor(Date.now()/1000),previousIndexedNonce=0) {
 if(!Number.isSafeInteger(seconds)||seconds<0)throw Error('integer nonnegative seconds required');
 if(!Number.isInteger(previousIndexedNonce)||previousIndexedNonce<0||previousIndexedNonce>MAX_NONCE)throw Error('invalid previous indexed nonce');
 return validateNonce(Math.max(seconds%MAX_NONCE+1,previousIndexedNonce+1));
}
export const quoteArg=s=>"'"+s.replaceAll("'", "'\\''")+"'";
const u32=n=>{if(!Number.isInteger(n)||n<0||n>0xffffffff)throw Error('u32 required');const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const vector=b=>Buffer.concat([u32(b.length),b]);
const string=s=>vector(Buffer.from(s));
export function payloads(content,nonce) {
 validateNonce(nonce);u32(content.length);
 const hash=createHash('sha256').update(content).digest('hex'),path=`${hash}.wasm`,mime='application/wasm';
 if(content.length<=CHUNK)return [Buffer.concat([Buffer.from([0]),string(path),Buffer.from([1]),string(mime),vector(content)])];
 const out=[];for(let offset=0;offset<content.length;offset+=CHUNK)out.push(Buffer.concat([Buffer.from([1]),string(path),u32(offset),u32(content.length),string(mime),vector(content.subarray(offset,offset+CHUNK)),u32(nonce)]));return out;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const [file,dir,n='auto',previous='0']=process.argv.slice(2);if(!file||!dir)throw Error('usage: node scripts/pledge/fastfs-payloads.mjs CANDIDATE_WASM EMPTY_OUTPUT_DIR [NONCE_OR_auto] [PREVIOUS_INDEXED_NONCE]');
 const nonce=n==='auto'?deriveNonce(Math.floor(Date.now()/1000),Number(previous)):validateNonce(Number(n));
 const data=readFileSync(file),id=JSON.parse(readFileSync('identity.json')).worker_candidate;
 if(data.length!==id.bytes||createHash('sha256').update(data).digest('hex')!==id.wasm_sha256)throw Error('candidate bytes mismatch');
 mkdirSync(dir);const rows=payloads(data,nonce).map((b,i)=>{const f=resolve(join(dir,`chunk-${i+1}.borsh`));writeFileSync(f,b,{flag:'wx'});return {step:i+1,file:f,payload_sha256:createHash('sha256').update(b).digest('hex'),command:`test ! -e ${quoteArg(f+'.signed.json')} && near contract call-function as-transaction outlayer.near __fastdata_fastfs file-args ${quoteArg(f)} prepaid-gas '0.000000000001 Tgas' attached-deposit '0 NEAR' sign-as keyhole-devmo.near network-config mainnet sign-with-keychain save-to-file ${quoteArg(f+'.signed.json')}`,send_command:`near transaction send-signed-transaction file-with-base64-signed-transaction ${quoteArg(f+'.signed.json')} network-config mainnet send`};});
 const plan={wasm_sha256:id.wasm_sha256,bytes:data.length,batch_nonce:nonce,chunks:rows,note:'Unsigned only. Journal original signed hash before each send. Resume next NEVER-SUBMITTED chunk only after FINAL original/indexing gates. Never rerun the official uploader on UNKNOWN.'};writeFileSync(join(dir,'upload-plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(plan,null,2));
}
