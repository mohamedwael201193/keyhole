import {it,expect} from "vitest";
import {readFileSync} from "node:fs";
it("clean-install crypto resolutions match the declared hash override",()=>{
 const lock=JSON.parse(readFileSync(new URL("../package-lock.json",import.meta.url),"utf8"));
 for(const module of ["@near-js/crypto","@near-js/keystores-browser","@near-js/signers","@near-js/transactions"]){
  expect(lock.packages[`node_modules/${module}/node_modules/@noble/hashes`]?.version).toBe("1.8.0");
 }
 for(const module of ["@near-js/crypto","@near-js/keystores-browser"]){
  expect(lock.packages[`node_modules/${module}/node_modules/@noble/curves/node_modules/@noble/hashes`]).toBeUndefined();
 }
});
