/** Fixed-window per-key limiter. In-memory per function instance; the TEE enforces the authoritative per-holder limits. */
export function createLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string, now = Date.now()) => {
    const h = hits.get(key);
    if (!h || h.reset <= now) { hits.set(key, { n: 1, reset: now + windowMs }); if (hits.size > 5000) hits.clear(); return { ok: true, retryAfter: 0 }; }
    h.n += 1;
    return h.n > limit ? { ok: false, retryAfter: Math.ceil((h.reset - now) / 1000) } : { ok: true, retryAfter: 0 };
  };
}
