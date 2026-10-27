/** Pure validation for the server route; kept separate so it is unit-tested. */
/** Holder-facing ops only. swap/copy/withdraw (move funds) are CLI-only for now; sweep_minter is operator-only. */
export const ALLOWED_OPS = ["info", "status", "quote", "mint", "account", "balance", "history"] as const;
export const MAX_BODY = 8 * 1024;
export type GatewayCheck = { ok: true; op: string; auth?: unknown } | { ok: false; status: number; code: string };

export function checkBody(raw: string): GatewayCheck {
  if (raw.length > MAX_BODY) return { ok: false, status: 413, code: "too_large" };
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return { ok: false, status: 400, code: "bad_params" }; }
  if (!j || typeof j !== "object") return { ok: false, status: 400, code: "bad_params" };
  const { op, auth } = j as { op?: unknown; auth?: unknown };
  if (typeof op !== "string" || !(ALLOWED_OPS as readonly string[]).includes(op)) return { ok: false, status: 400, code: "bad_op" };
  if (op !== "info") {
    const a = auth as Record<string, unknown> | undefined;
    const fields = ["account_id", "public_key", "signature", "nonce", "message", "recipient"];
    if (!a || typeof a !== "object" || !fields.every((f) => typeof a[f] === "string")) return { ok: false, status: 400, code: "no_auth" };
    try { if ((JSON.parse(a.message as string) as { op?: string }).op !== op) return { ok: false, status: 400, code: "op_mismatch" }; }
    catch { return { ok: false, status: 400, code: "bad_message" }; }
  }
  return { ok: true, op, auth };
}
