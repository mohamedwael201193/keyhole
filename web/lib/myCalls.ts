/**
 * The holder's own enclave calls from this browser, newest first: the call id, the op and the time. Nothing else is kept (no
 * amounts, no tokens, no signatures), in sessionStorage, so it is gone when the tab closes. The "My proof" section lists them so a
 * holder can re-check any of their own calls without leaving the dashboard.
 */
export type MyCall = { call_id: string; op: string; ts_ms: number };
const KEY = "kh_my_calls_v1";
const MAX = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MY_CALLS_EVENT = "keyhole-my-calls";

export const OP_WORDS: Record<string, string> = {
  balance: "Balance read", history: "Activity read", dashboard: "Dashboard read", status: "Account status", quote: "Swap quote", swap: "Swap",
  exact_near_exit_v1: "Withdrawal", withdraw: "Withdrawal", account: "Deposit address", limits: "Limits", pnl: "Swap log",
  level_up: "Tier check", reconcile_value_op: "Original operation check", mint: "Mint", session: "Session unlock", transfer: "Key transfer",
};
export const opWord = (op: string) => OP_WORDS[op] ?? op.replace(/_/g, " ");

export function readMyCalls(store: Pick<Storage, "getItem"> = sessionStorage): MyCall[] {
  try {
    const v = JSON.parse(store.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((c): c is MyCall => !!c && typeof c.call_id === "string" && UUID.test(c.call_id) && typeof c.op === "string" && Number.isFinite(c.ts_ms)) : [];
  } catch { return []; }
}

export function rememberCall(op: string, callId: unknown, now = Date.now(), store: Pick<Storage, "getItem" | "setItem"> = sessionStorage) {
  if (typeof callId !== "string" || !UUID.test(callId)) return;
  const rest = readMyCalls(store).filter((c) => c.call_id !== callId);
  store.setItem(KEY, JSON.stringify([{ call_id: callId, op, ts_ms: now }, ...rest].slice(0, MAX)));
}
