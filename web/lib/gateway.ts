/** Pure validation for the server route; kept separate so it is unit-tested. */
/**
 * Holder-facing ops. `swap` and `withdraw` are relayed only when `checkBody` finds an
 * auth object whose signed message names that same op. `provenance` and `record` are public and
 * carry no auth (`record` is answered only for a key listed for sale). The TEE still verifies the signature, the nonce and the caps.
 */
export const ALLOWED_OPS = ["info", "provenance", "record", "loan_certificate", "status", "quote", "mint", "account", "balance", "history", "swap", "withdraw", "lock", "prove", "limits", "pnl", "dashboard", "level_up", "session", "session_revoke"] as const;
export const MAX_BODY = 8 * 1024;
/** A key id as the key page reads it: k + hex, or a legacy number. Mirrors KEY_ID in app/key/view.tsx. */
const KEY_ID = /^(k[a-z0-9]{4,39}|\d{1,9})$/i;
export type GatewayCheck = { ok: true; op: string; auth?: unknown; params?: {token_id:string;loan_nonce:string} } | { ok: false; status: number; code: string };

export function checkBody(raw: string): GatewayCheck {
  if (raw.length > MAX_BODY) return { ok: false, status: 413, code: "too_large" };
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return { ok: false, status: 400, code: "bad_params" }; }
  if (!j || typeof j !== "object") return { ok: false, status: 400, code: "bad_params" };
  const { op, auth } = j as { op?: unknown; auth?: unknown };
  if (typeof op !== "string" || !(ALLOWED_OPS as readonly string[]).includes(op)) return { ok: false, status: 400, code: "bad_op" };
  if(op==="loan_certificate") {
    const p=(j as {params?:unknown}).params;
    if(!p||typeof p!=="object"||Array.isArray(p))return {ok:false,status:400,code:"bad_params"};
    const x=p as Record<string,unknown>;
    if(Object.keys(x).length!==2||typeof x.token_id!=="string"||!x.token_id.length||new TextEncoder().encode(x.token_id).length>64||typeof x.loan_nonce!=="string"||!/^\d{1,20}$/.test(x.loan_nonce)||BigInt(x.loan_nonce)>18446744073709551615n)return {ok:false,status:400,code:"bad_params"};
    return {ok:true,op,params:{token_id:x.token_id,loan_nonce:x.loan_nonce}};
  }
  if (op === "record") {
    // The signed record of a listed key. Public like provenance: no auth, and the enclave answers only for listed keys.
    const id = (j as { token_id?: unknown }).token_id;
    if (typeof id !== "string" || !KEY_ID.test(id)) return { ok: false, status: 400, code: "bad_params" };
    return { ok: true, op };
  }
  if (op !== "info" && op !== "provenance") {
    const a = auth as Record<string, unknown> | undefined;
    if (!a || typeof a !== "object") return { ok: false, status: 400, code: "no_auth" };
    const fields = a.scheme === "session"
      ? ["scheme", "token", "nonce", "message", "recipient"]
      : a.scheme === "eip191"
      ? ["scheme", "account_id", "address", "signature", "nonce", "message", "recipient"]
      : ["account_id", "public_key", "signature", "nonce", "message", "recipient"];
    if (!fields.every((f) => typeof a[f] === "string" && (a[f] as string).length > 0)) return { ok: false, status: 400, code: "no_auth" };
    // Withdraw needs a fresh wallet signature. The enclave refuses a session token for it too; this is the early refusal.
    if (op === "withdraw" && a.scheme === "session") return { ok: false, status: 403, code: "session_scope" };
    try { if ((JSON.parse(a.message as string) as { op?: string }).op !== op) return { ok: false, status: 400, code: "op_mismatch" }; }
    catch { return { ok: false, status: 400, code: "bad_message" }; }
  }
  return { ok: true, op, auth };
}
