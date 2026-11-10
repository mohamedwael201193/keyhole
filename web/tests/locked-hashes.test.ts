import {it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {dirname} from "node:path";
it("clean-install hash resolutions honor exact upstream pins and keep app v2 separate",()=>{
 const lock=JSON.parse(readFileSync(new URL("../package-lock.json",import.meta.url),"utf8"));
 const manifest=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
 expect(JSON.stringify(manifest.overrides)).not.toContain("@noble/hashes");
 const resolveHash=(parent:string)=>{
  for(let path=parent;;path=dirname(path)){
   const entry=lock.packages[`${path==="."?"":path+"/"}node_modules/@noble/hashes`];
   if(entry)return entry.version;
   if(path===".")throw new Error(`Missing hash dependency for ${parent}`);
  }
 };
 let exactPins=0;
 for(const [path,untyped] of Object.entries(lock.packages)){
  const pkg=untyped as {dependencies?:Record<string,string>};
  if(pkg.dependencies?.["@noble/hashes"]==="1.7.1"){
   expect(resolveHash(path),path).toBe("1.7.1");exactPins++;
  }
 }
 expect(exactPins).toBeGreaterThanOrEqual(4);
 expect(resolveHash("node_modules/@noble/curves")).toBe("2.4.0");
 expect(lock.packages["node_modules/@noble/hashes"].version).toBe("2.4.0");
});
