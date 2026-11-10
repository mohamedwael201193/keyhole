import { describe,it,expect } from "vitest";
import {checkOpening,eventHash,eventCanonical,checkLog,type KeyEvent} from "@/lib/keylog";
const e=():KeyEvent=>({i:0,prev:"0".repeat(64),kind:"withdraw",owner:"alice.near",ts_ms:10,v:2,contract:"keys.near",owner_epoch:7,detail:"x",blinding_nonce:"05".repeat(32),detail_hash:"41c6674c0053cd4edcc933ab251914fbf00b5a0dd72e57343f654d9bcf99a8e9",hash:""});
describe("versioned event commitments",()=>{
 it("matches independent Rust and Node opening vector",()=>expect(checkOpening(e(),"k1")).toBe(true));
 it("requires exact bytes and nonce",()=>{expect(checkOpening({...e(),detail:"x "},"k1")).toBe(false);expect(checkOpening({...e(),blinding_nonce:undefined},"k1")).toBe(false);});
 it("binds context and epoch",()=>{expect(checkOpening(e(),"k2")).toBe(false);expect(checkOpening({...e(),owner_epoch:8},"k1")).toBe(false);});
 it("canonical does not reveal opening",()=>{expect(eventCanonical(e(),"k1")).not.toContain("blinding_nonce");expect(eventCanonical(e(),"k1")).not.toContain('"detail":');});
 it("checks a public v2 chain without openings",()=>{const row={...e(),detail:undefined,blinding_nonce:undefined};row.hash=eventHash(row,"k1");expect(checkLog({token_id:"k1",head:row.hash,events:[row],sig:"",minter:""},"").chain).toBe(true);});
 it("rejects tampered supplied openings even when the public chain is intact",()=>{const row=e();row.hash=eventHash(row,"k1");const doc={token_id:"k1",head:row.hash,events:[row],sig:"",minter:""};expect(checkLog(doc,"").chain).toBe(true);expect(checkLog({...doc,events:[{...row,detail:"changed"}]},"").chain).toBe(false);});
 it("rejects unsupported versions",()=>{const row={...e(),v:3};row.hash=eventHash(row,"k1");expect(checkLog({token_id:"k1",head:row.hash,events:[row],sig:"",minter:""},"").chain).toBe(false);});
});
