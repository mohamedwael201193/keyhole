import { afterEach, expect, it, vi } from "vitest";
import { callWorker } from "../lib/worker";
import type { SignedAuth } from "../lib/nep413";
afterEach(() => vi.unstubAllGlobals());
const base: SignedAuth = { account_id:"alice.near",public_key:"ed25519:test",signature:"signed",nonce:"nonce",message:"{}",recipient:"keyhole" };
function capture() {
  const send=vi.fn().mockResolvedValue({json:async()=>({output:{ok:true}})});vi.stubGlobal("fetch",send);return send;
}
it("normalizes wallet NEP-413 before exact admission and original-operation reconciliation",async()=>{
  const send=capture();
  for(const op of ["exact_near_exit_v1","reconcile_value_op"] as const){
    await callWorker(op,base);
    const request=JSON.parse(send.mock.calls.at(-1)![1].body);
    expect(request).toEqual({op,auth:{...base,scheme:"nep413"}});
    expect(request.auth.message).toBe(base.message);
    expect(base.scheme).toBeUndefined();
  }
});
it("never relabels session, Ethereum or explicitly tagged NEP-413 authentication",async()=>{
  const send=capture();
  for(const scheme of ["session","eip191","nep413"] as const){
    const auth={...base,scheme};await callWorker("status",auth);
    expect(JSON.parse(send.mock.calls.at(-1)![1].body).auth).toEqual(auth);
  }
});
