import {it,expect,vi} from "vitest";
import {readFileSync} from "node:fs";
import {readFinalReceipt} from "../e2e/support/final-receipt";
import type {FinalWalletReceipt} from "../e2e/support/pledge-ledger";
const final={final_execution_status:"FINAL",transaction:{hash:"same-hash"}} as FinalWalletReceipt;
const timeout={error:{cause:{name:"TIMEOUT_ERROR"}}};
it("a transient timeout is not success; a later genuine FINAL read is required",async()=>{
 const read=vi.fn().mockResolvedValueOnce(timeout).mockResolvedValueOnce({result:final});
 expect(await readFinalReceipt(read)).toBe(final);expect(read).toHaveBeenCalledTimes(2);
});
it("an exhausted read budget throws and never returns pending as a receipt",async()=>{
 const read=vi.fn().mockResolvedValue(timeout);
 await expect(readFinalReceipt(read)).rejects.toThrow("TIMEOUT_ERROR");expect(read).toHaveBeenCalledTimes(3);
});
it("non-timeout RPC errors fail closed without another read",async()=>{
 const read=vi.fn().mockResolvedValue({error:{cause:{name:"UNKNOWN_TRANSACTION"}}});
 await expect(readFinalReceipt(read)).rejects.toThrow("UNKNOWN_TRANSACTION");expect(read).toHaveBeenCalledTimes(1);
});
it.each(["NONE","INCLUDED","EXECUTED_OPTIMISTIC","EXECUTED"])("%s never becomes FINAL",async status=>{
 await expect(readFinalReceipt(async()=>({result:{...final,final_execution_status:status}}))).rejects.toThrow("pending");
});
it("missing/malformed results are not receipt evidence",async()=>{
 await expect(readFinalReceipt(async()=>({}))).rejects.toThrow("missing result");
});

it("funded FINAL evidence is captured at submission, before any later clock advance",()=>{
 const source=readFileSync(new URL("../e2e/pledge-funded.spec.ts",import.meta.url),"utf8");
 const submit=source.split("async function submit(")[1].split("async function refresh(")[0];
 expect(submit).toContain("nativeReceipts.push(await readFinalReceipt(");
 expect(submit).toContain("tx_hash:submission.hash,sender_account_id:submission.account,wait_until:\"FINAL\"");
 expect(submit.indexOf("nativeReceipts.push")).toBeLessThan(submit.indexOf("return submission"));
 expect(source).toContain("assertFundedWalletLedger(submissions,nativeReceipts)");
 expect(source).not.toContain('Promise.all(submissions.map(x=>rpc("tx"');
});
