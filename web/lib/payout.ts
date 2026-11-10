import { nearView } from "./rpc";
import { KEYS_CONTRACT, RPC_URL } from "./config";
import type { KeysCall } from "./keysTx";
import { isMethodNotFound } from "./rpcError";
export type PayoutState = { supported: false } | { supported: true; registered: boolean; cost: string; credit: string; pending: { nonce: string; amount: string } | null };
type Read = <T>(m: string, a: Record<string, unknown>) => Promise<T>;
const digits = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9]\d*)$/.test(v);
/** Only a definitive missing method identifies v2.4. RPC failure must never downgrade the policy. */
export async function readPayout(account: string, read: Read = (m,a) => nearView(m,a,KEYS_CONTRACT,{shared:false})): Promise<PayoutState> {
  let cost: string;
  try { cost = await read<string>("payout_storage_cost", {}); }
  catch (e) { if (isMethodNotFound(e)) return { supported: false }; throw e; }
  const [registered, credit, pending] = await Promise.all([read<boolean>("payout_account_registered", { account_id: account }), read<string>("get_payout_credit", { account_id: account }), read<{ nonce: string; amount: string } | null>("get_pending_payout", { account_id: account })]);
  if (!digits(cost) || BigInt(cost) <= 0n || typeof registered !== "boolean" || !digits(credit) || (pending !== null && (!digits(pending?.nonce) || !digits(pending?.amount)))) throw new Error("Invalid payout state");
  return { supported: true, registered, cost, credit, pending };
}
export function registerPayoutCall(s: PayoutState, acceptedCost: string): KeysCall {
  if (!s.supported || s.registered || s.cost !== acceptedCost) throw new Error("Read and accept the exact nonrefundable storage cost first");
  return { method: "register_payout_account", args: {}, deposit: s.cost, gas: "30000000000000" };
}
export function claimPayoutCall(s: PayoutState): KeysCall {
  if (!s.supported || !s.registered || s.pending || BigInt(s.credit) <= 0n) throw new Error("No claimable credit or payout is pending");
  return { method: "claim_payout", args: {}, deposit: "1", gas: "70000000000000" };
}
/** A wallet hash/HTTP 200 is not cash delivery. Require final complete receipt tree and callback true. */
export function payoutReceiptFinal(j: any, account: string): boolean {
  return j?.final_execution_status === "FINAL" && j?.transaction?.signer_id === account && j?.transaction?.receiver_id === KEYS_CONTRACT &&
    j.transaction.actions?.length === 1 && j.transaction.actions[0]?.FunctionCall?.method_name === "claim_payout" &&
    j.status?.SuccessValue === "dHJ1ZQ==" && Array.isArray(j.receipts_outcome) && j.receipts_outcome.length >= 2 &&
    j.receipts_outcome.every((r: any) => r.outcome?.status && !r.outcome.status.Failure && (typeof r.outcome.status.SuccessValue === "string" || typeof r.outcome.status.SuccessReceiptId === "string"));
}
export async function verifyPayoutReceipt(hash: string, account: string): Promise<boolean> {
  const r = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(10000), body: JSON.stringify({ jsonrpc: "2.0", id: "payout", method: "tx", params: { tx_hash: hash, sender_account_id: account, wait_until: "FINAL" } }) });
  const j = await r.json(); return r.ok && !j.error && j.result?.transaction?.hash === hash && payoutReceiptFinal(j.result, account);
}
