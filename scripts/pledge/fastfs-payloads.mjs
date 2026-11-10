// OFFLINE ONLY. Pinned official v0.2.2 FastFS Borsh wire format; never signs/sends.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
export const CHUNK=1<<20;
export const quoteArg=s=>"'"+s.replaceAll("'", "'\\''")+"'";
const u32=n=>{if(!Number.isInteger(n)||n<0||n>0xffffffff)throw Error('u32 required');const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const vector=b=>Buffer.concat([u32(b.length),b]);
const string=s=>vector(Buffer.from(s));
export function payloads(content,nonce) {
 u32(nonce);u32(content.length);
 const hash=createHash('sha256').update(content).digest('hex'),path=`${hash}.wasm`,mime='application/wasm';
 if(content.length<=CHUNK)return [Buffer.concat([Buffer.from([0]),string(path),Buffer.from([1]),string(mime),vector(content)])];
 const out=[];for(let offset=0;offset<content.length;offset+=CHUNK)out.push(Buffer.concat([Buffer.from([1]),string(path),u32(offset),u32(content.length),string(mime),vector(content.subarray(offset,offset+CHUNK)),u32(nonce)]));return out;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const [file,dir,n]=process.argv.slice(2);if(!file||!dir||n===undefined)throw Error('usage: node scripts/pledge/fastfs-payloads.mjs CANDIDATE_WASM EMPTY_OUTPUT_DIR FIXED_U32_BATCH_NONCE');
 const data=readFileSync(file),id=JSON.parse(readFileSync('identity.json')).worker_candidate;
 if(data.length!==id.bytes||createHash('sha256').update(data).digest('hex')!==id.wasm_sha256)throw Error('candidate bytes mismatch');
 mkdirSync(dir);const rows=payloads(data,Number(n)).map((b,i)=>{const f=resolve(join(dir,`chunk-${i+1}.borsh`));writeFileSync(f,b,{flag:'wx'});return {step:i+1,file:f,payload_sha256:createHash('sha256').update(b).digest('hex'),command:`test ! -e ${quoteArg(f+'.signed.json')} && near contract call-function as-transaction outlayer.near __fastdata_fastfs file-args ${quoteArg(f)} prepaid-gas '0.000000000001 Tgas' attached-deposit '0 NEAR' sign-as keyhole-devmo.near network-config mainnet sign-with-keychain save-to-file ${quoteArg(f+'.signed.json')}`,send_command:`near transaction send-signed-transaction file-with-base64-signed-transaction ${quoteArg(f+'.signed.json')} network-config mainnet send`};});
 const plan={wasm_sha256:id.wasm_sha256,bytes:data.length,batch_nonce:Number(n),chunks:rows,note:'Unsigned only. Journal original signed hash before each send. Resume next NEVER-SUBMITTED chunk only after FINAL original/indexing gates. Never rerun the official uploader on UNKNOWN.'};writeFileSync(join(dir,'upload-plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(plan,null,2));
}
