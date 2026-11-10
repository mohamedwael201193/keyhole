import type {FinalWalletReceipt} from "./pledge-ledger";
type Reply={result?:FinalWalletReceipt;error?:{cause?:{name?:string};message?:string}};
/** Read-only retries of the SAME hash/signer after a node timeout; never resubmit a transaction.
 * A timeout or pending reply is not a receipt and cannot enter the 13-entry ledger. */
export async function readFinalReceipt(read:()=>Promise<Reply>):Promise<FinalWalletReceipt>{
 for(let attempt=0;attempt<3;attempt++){
  const reply=await read();
  if(reply.error){
   if(reply.error.cause?.name==="TIMEOUT_ERROR"&&attempt<2)continue;
   throw Error("FINAL receipt unavailable: "+(reply.error.cause?.name??reply.error.message??"RPC error"));
  }
  if(reply.result?.final_execution_status!=="FINAL")throw Error("FINAL receipt unavailable: pending or missing result");
  return reply.result;
 }
 throw Error("FINAL receipt unavailable");
}
