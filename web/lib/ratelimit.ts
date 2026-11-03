/** Fixed-window per-key limiter. In-memory per function instance; the TEE enforces the authoritative per-holder limits.
 *  At capacity it drops expired windows only; if every window is still live a new key is refused (fail closed),
 *  so a flood of fresh keys can never reset a client that is inside its window. */
export const LIMITER_CAP = 5000;
export function createLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string, now = Date.now()) => {
    const h = hits.get(key);
    if (!h || h.reset <= now) {
      if (!h && hits.size >= LIMITER_CAP) {
        for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
        if (hits.size >= LIMITER_CAP) return { ok: false, retryAfter: Math.ceil(windowMs / 1000) };
      }
      hits.set(key, { n: 1, reset: now + windowMs });
      return { ok: true, retryAfter: 0 };
    }
    h.n += 1;
    return h.n > limit ? { ok: false, retryAfter: Math.ceil((h.reset - now) / 1000) } : { ok: true, retryAfter: 0 };
  };
}
