import {describe,it,expect} from "vitest";
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from "node:fs";
import {resolve,join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
type Patch={package:string;version:string;file:string;before:string;after:string;count:number;pristine_sha256:string;patched_sha256:string;pristine_offsets_utf8:number[]};
const root=resolve(import.meta.dirname,"..");
const patches:Patch[]=JSON.parse(readFileSync(join(root,"scripts/wallet-dependency-patches.json"),"utf8"));
const installed=JSON.parse(readFileSync(join(root,"package-lock.json"),"utf8")).packages;
const sha=(bytes:string|Buffer)=>createHash("sha256").update(bytes).digest("hex");
// Offset-only reverse deltas reconstruct exact registry-pristine files offline, without
// redistributing SDK source fixtures. Both forms are bound to verified full-file digests.
function pristine(patch:Patch):Buffer{
 const path=Object.keys(installed).find(path=>path===`node_modules/${patch.package}`||path.endsWith(`/node_modules/${patch.package}`));
 if(!path)throw Error("Missing installed consumer");
 let bytes=readFileSync(join(root,path,patch.file));
 if(sha(bytes)===patch.pristine_sha256)return bytes;
 expect(sha(bytes)).toBe(patch.patched_sha256);
 const before=Buffer.from(patch.before),after=Buffer.from(patch.after);
 for(let i=patch.pristine_offsets_utf8.length-1;i>=0;i--){
  const offset=patch.pristine_offsets_utf8[i]+i*(after.length-before.length);
  expect(bytes.subarray(offset,offset+after.length)).toEqual(after);
  bytes=Buffer.concat([bytes.subarray(0,offset),before,bytes.subarray(offset+after.length)]);
 }
 expect(sha(bytes)).toBe(patch.pristine_sha256);return bytes;
}
const originals=patches.map(pristine);
function fixture(job:(dir:string)=>void){
 const dir=mkdtempSync(join(tmpdir(),"keyhole-wallet-patches-"));
 try{
  mkdirSync(join(dir,"scripts"));
  for(const file of ["patch-wallet-deps.mjs","wallet-dependency-patches.json"])writeFileSync(join(dir,"scripts",file),readFileSync(join(root,"scripts",file)));
  const packages:Record<string,{version:string}>={};
  for(const [i,patch] of patches.entries()){
   const path=`node_modules/${patch.package}`;packages[path]={version:patch.version};
   const file=join(dir,path,patch.file);mkdirSync(resolve(file,".."),{recursive:true});writeFileSync(file,originals[i]);
  }
  writeFileSync(join(dir,"package-lock.json"),JSON.stringify({packages}));job(dir);
 }finally{rmSync(dir,{recursive:true,force:true});}
}
const file=(dir:string,p:Patch)=>join(dir,"node_modules",p.package,p.file);
const run=(dir:string)=>spawnSync(process.execPath,[join(dir,"scripts/patch-wallet-deps.mjs")],{encoding:"utf8"});
const bytes=(dir:string)=>patches.map(p=>readFileSync(file(dir,p)));
describe("exact wallet postinstall lifecycle",()=>{
 it("patches every pristine ESM/CJS file, then accepts two byte-identical repeat runs",()=>fixture(dir=>{
  const first=run(dir);expect(first.status,first.stderr).toBe(0);expect(first.stdout).toContain("10 files updated");
  const expected=bytes(dir);for(const [i,p] of patches.entries())expect(sha(expected[i])).toBe(p.patched_sha256);
  for(let i=0;i<2;i++){const again=run(dir);expect(again.status,again.stderr).toBe(0);expect(again.stdout).toContain("0 files updated");expect(bytes(dir)).toEqual(expected);}
 }));
 it("preserves x402's two pre-existing explicit records as well as its four migrated records",()=>fixture(dir=>{
  expect(run(dir).status).toBe(0);
  for(const [i,p] of patches.entries())if(p.package==="x402"){
   expect(originals[i].toString().split(p.after).length-1).toBe(2);
   expect(readFileSync(file(dir,p),"utf8").split(p.after).length-1).toBe(6);
  }
 }));
 it("rejects unknown pristine bytes even with unchanged match counts, before any file is modified",()=>fixture(dir=>{
  const p=patches.at(-1)!;writeFileSync(file(dir,p),Buffer.concat([readFileSync(file(dir,p)),Buffer.from("\n// drift")]));
  const before=bytes(dir),result=run(dir);expect(result.status).not.toBe(0);expect(result.stderr).toContain("unknown content");expect(bytes(dir)).toEqual(before);
 }));
 it("rejects corrupted patched bytes instead of accepting arbitrary six-match content",()=>fixture(dir=>{
  expect(run(dir).status).toBe(0);const p=patches.at(-1)!;writeFileSync(file(dir,p),readFileSync(file(dir,p),"utf8")+"\n");
  const before=bytes(dir),result=run(dir);expect(result.status).not.toBe(0);expect(result.stderr).toContain("unknown content");expect(bytes(dir)).toEqual(before);
 }));
 it("rejects a consumer version change before writing any otherwise valid file",()=>fixture(dir=>{
  const path=join(dir,"package-lock.json"),lock=JSON.parse(readFileSync(path,"utf8"));lock.packages["node_modules/x402"].version="0.7.4";writeFileSync(path,JSON.stringify(lock));
  const before=bytes(dir),result=run(dir);expect(result.status).not.toBe(0);expect(result.stderr).toContain("Unreviewed x402@0.7.4");expect(bytes(dir)).toEqual(before);
 }));
 it("resumes a mixed known pristine/patched installation without rewriting completed files",()=>fixture(dir=>{
  for(const [i,p] of patches.entries())if(i%2===0)writeFileSync(file(dir,p),originals[i].toString().replaceAll(p.before,p.after));
  const result=run(dir);expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain("5 files updated");
  for(const p of patches)expect(sha(readFileSync(file(dir,p)))).toBe(p.patched_sha256);
 }));
 it("rejects a missing consumer before partially migrating the other package",()=>fixture(dir=>{
  const path=join(dir,"package-lock.json"),lock=JSON.parse(readFileSync(path,"utf8"));delete lock.packages["node_modules/x402"];writeFileSync(path,JSON.stringify(lock));
  const before=bytes(dir),result=run(dir);expect(result.status).not.toBe(0);expect(result.stderr).toContain("Missing migration consumer x402");expect(bytes(dir)).toEqual(before);
 }));
});
