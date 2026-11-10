/**
 * NEAR view failures name one MethodResolveError variant.
 * Only MethodNotFound is a missing method. MethodInvalidSignature, a bare
 * MethodResolveError, prose such as "method not found", and transport errors are not.
 * This matches tee/worker/src/mint_payout.rs: the MethodNotFound token is not a
 * substring of MethodInvalidSignature.
 */

export function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function variantFromText(text: string): string | null {
  const paren = text.match(/MethodResolveError\(([A-Za-z0-9_]+)\)/);
  if (paren) return paren[1];
  const jsonish = text.match(/"MethodResolveError"\s*:\s*"([A-Za-z0-9_]+)"/);
  return jsonish ? jsonish[1] : null;
}

function variantFromValue(value: unknown, depth = 0): string | null {
  if (depth > 6 || value == null) return null;
  if (typeof value === "string") return variantFromText(value);
  if (typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = variantFromValue(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.MethodResolveError === "string" && /^[A-Za-z0-9_]+$/.test(record.MethodResolveError)) return record.MethodResolveError;
  for (const item of Object.values(record)) {
    const found = variantFromValue(item, depth + 1);
    if (found) return found;
  }
  return null;
}

/** The named MethodResolveError variant, when the error carries one. */
export function methodResolveVariant(error: unknown): string | null {
  return variantFromValue(error) ?? variantFromText(errorText(error));
}

/** True only for the definitive missing-method variant. Never treats a transport failure as legacy. */
export function isMethodNotFound(error: unknown): boolean {
  const variant = methodResolveVariant(error);
  if (variant) return variant === "MethodNotFound";
  return errorText(error).includes("MethodNotFound");
}
