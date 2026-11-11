/** Pure validation for the server route; kept separate so it is unit-tested. */
/**
 * Holder-facing ops. `swap` and `withdraw` are relayed only when `checkBody` finds an
 * auth object whose signed message names that same op. `provenance` and `record` are public and
 * carry no auth (`record` is answered only for a key listed for sale). The TEE still verifies the signature, the nonce and the caps.
 */
export const ALLOWED_OPS = ["reconcile_value_op", "loan_certificate", "pledge_inventory", "info", "provenance", "record", "status", "quote", "mint", "account", "balance", "history", "swap", "exact_near_exit_v1", "withdraw", "withdraw_dry_run", "lock", "prove", "limits", "pnl", "dashboard", "level_up", "session", "session_revoke"] as const;
export const MAX_BODY = 8 * 1024;
/** A key id as the key page reads it: k + hex, or a legacy number. Mirrors KEY_ID in app/key/view.tsx. */
const KEY_ID = /^(k[a-z0-9]{4,39}|\d{1,9})$/i;
export type GatewayCheck = { ok: true; op: string; auth?: unknown; params?: { token_id: string; loan_nonce: string } } | { ok: false; status: number; code: string };

export function checkBody(raw: string): GatewayCheck {
  if (raw.length > MAX_BODY) return { ok: false, status: 413, code: "too_large" };
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return { ok: false, status: 400, code: "bad_params" }; }
  if (!j || typeof j !== "object") return { ok: false, status: 400, code: "bad_params" };
  const { op, auth } = j as { op?: unknown; auth?: unknown; params?: { token_id: string; loan_nonce: string } };
  if (typeof op !== "string" || !(ALLOWED_OPS as readonly string[]).includes(op)) return { ok: false, status: 400, code: "bad_op" };
  if (op === "loan_certificate") {
    const p = (j as { params?: Record<string, unknown> }).params;
    if (!p || Object.keys(p).sort().join(",") !== "loan_nonce,token_id" || typeof p.token_id !== "string" || !KEY_ID.test(p.token_id) || typeof p.loan_nonce !== "string" || !/^(0|[1-9]\d{0,19})$/.test(p.loan_nonce) || BigInt(p.loan_nonce) > 18446744073709551615n) return { ok: false, status: 400, code: "bad_params" };
    return { ok: true, op, params: { token_id: p.token_id, loan_nonce: p.loan_nonce } };
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
    if ((op === "exact_near_exit_v1" || op === "withdraw" || op === "withdraw_dry_run" || op === "reconcile_value_op") && a.scheme === "session") return { ok: false, status: 403, code: "session_scope" };
    try { if ((JSON.parse(a.message as string) as { op?: string }).op !== op) return { ok: false, status: 400, code: "op_mismatch" }; }
    catch { return { ok: false, status: 400, code: "bad_message" }; }
    if (op === "reconcile_value_op") {
      const p = JSON.parse(a.message as string).params;
      if (!p || typeof p.token_id !== "string" || !KEY_ID.test(p.token_id) || typeof p.value_op_id !== "string" || !/^[1-9]\d{0,19}:[0-9a-f]{64}$/.test(p.value_op_id)) return { ok: false, status: 400, code: "bad_params" };
    }
  }
  return { ok: true, op, auth };
}
