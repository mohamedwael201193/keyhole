/** Pure validation for the server route; kept separate so it is unit-tested. */
/**
 * Holder-facing ops. `swap` and `withdraw` are relayed only when `checkBody` finds an
 * auth object whose signed message names that same op. `provenance` is public and
 * carries no auth. The TEE still verifies the signature, the nonce and the caps.
 */
export const ALLOWED_OPS = ["info", "provenance", "status", "quote", "mint", "account", "balance", "history", "swap", "withdraw", "lock", "prove", "limits", "pnl"] as const;
export const MAX_BODY = 8 * 1024;
export type GatewayCheck = { ok: true; op: string; auth?: unknown } | { ok: false; status: number; code: string };

export function checkBody(raw: string): GatewayCheck {
  if (raw.length > MAX_BODY) return { ok: false, status: 413, code: "too_large" };
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return { ok: false, status: 400, code: "bad_params" }; }
  if (!j || typeof j !== "object") return { ok: false, status: 400, code: "bad_params" };
  const { op, auth } = j as { op?: unknown; auth?: unknown };
  if (typeof op !== "string" || !(ALLOWED_OPS as readonly string[]).includes(op)) return { ok: false, status: 400, code: "bad_op" };
  if (op !== "info" && op !== "provenance") {
    const a = auth as Record<string, unknown> | undefined;
    if (!a || typeof a !== "object") return { ok: false, status: 400, code: "no_auth" };
    const fields = a.scheme === "eip191"
      ? ["scheme", "account_id", "address", "signature", "nonce", "message", "recipient"]
      : ["account_id", "public_key", "signature", "nonce", "message", "recipient"];
    if (!fields.every((f) => typeof a[f] === "string" && (a[f] as string).length > 0)) return { ok: false, status: 400, code: "no_auth" };
    try { if ((JSON.parse(a.message as string) as { op?: string }).op !== op) return { ok: false, status: 400, code: "op_mismatch" }; }
    catch { return { ok: false, status: 400, code: "bad_message" }; }
  }
  return { ok: true, op, auth };
}
