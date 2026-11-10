import {it,expect} from "vitest";
import {checkBody} from "@/lib/gateway";
it("accepts only the canonical integrated public token + nonce, never a caller floor or asset",()=>{
 // Integration's KEY_ID contract is narrower than the old generic 64-byte bound.
 const valid={op:"loan_certificate",params:{token_id:"k".repeat(40),loan_nonce:"1"}};
 expect(checkBody(JSON.stringify(valid))).toEqual({ok:true,op:"loan_certificate",params:valid.params});
 for(const params of [{...valid.params,floor_raw:"1"},{...valid.params,asset:"other"},{...valid.params,token_id:"k".repeat(41)},{...valid.params,token_id:"k".repeat(64)},{...valid.params,token_id:"k".repeat(65)},{...valid.params,loan_nonce:"01"},{...valid.params,loan_nonce:"18446744073709551616"},{...valid.params,loan_nonce:1},null,[]])expect(checkBody(JSON.stringify({...valid,params})).ok).toBe(false);
 for(const token_id of ["0","k1234"])expect(checkBody(JSON.stringify({...valid,params:{...valid.params,token_id}})).ok).toBe(true);
});
