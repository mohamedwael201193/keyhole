/** How long a health result may be reused. A live enclave stays cached longer than a miss. */
export const ONLINE_TTL_MS = 60_000;
export const OFFLINE_TTL_MS = 15_000;

export interface Stamped { at: number; online: boolean }

export function freshHealth<T extends Stamped>(cache: T | null, now = Date.now()): T | null {
  if (!cache) return null;
  const ttl = cache.online ? ONLINE_TTL_MS : OFFLINE_TTL_MS;
  return now - cache.at < ttl ? cache : null;
}

/** Concurrent callers await the same probe. The slot clears when that probe settles. */
export function shareCheck<T>(slot: { current: Promise<T> | null }, run: () => Promise<T>): Promise<T> {
  if (slot.current) return slot.current;
  const current = run().finally(() => { if (slot.current === current) slot.current = null; });
  slot.current = current;
  return current;
}
