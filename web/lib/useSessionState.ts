// Session-backed form state: what the user typed or picked survives a section
// switch inside /dashboard (the workspace unmounts the section that is not open)
// and survives a reload of the tab. Quotes, results, balances and anything
// secret are NEVER stored here: only form inputs and filters.
//
// Hydration-safe on purpose: the first render always uses `initial` (the same
// value the server rendered), and the saved value is restored in an effect
// after mount. Reading storage in the initializer would render different HTML
// on the client than on the server and log a hydration error.
import { useEffect, useState } from "react";

/** The smallest storage surface this module needs, so unit tests can pass a fake. */
export type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStore(): SessionStore | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Read and validate one stored JSON value. null when absent, unreadable, corrupt, or failing validation. */
export function readSessionValue<T>(key: string, validate: (v: unknown) => v is T, store: SessionStore | null = defaultStore()): T | null {
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return validate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Store one JSON value. Best-effort: a full or blocked store never throws. */
export function writeSessionValue<T>(key: string, value: T, store: SessionStore | null = defaultStore()): void {
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode, quota, or a blocked store: the form still works, it just does not survive navigation.
  }
}

export function removeSessionValue(key: string, store: SessionStore | null = defaultStore()): void {
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    // Best-effort, as above.
  }
}

/**
 * useState whose value is restored from sessionStorage after mount and saved
 * on every change. `validate` must be a module-level predicate (stable across
 * renders); a stored value that fails it is ignored and the initial is kept.
 */
export function useSessionState<T>(
  key: string,
  initial: T,
  validate: (v: unknown) => v is T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const saved = readSessionValue(key, validate);
    if (saved !== null) setValue(saved);
    setHydrated(true);
  }, [key, validate]);
  useEffect(() => {
    if (!hydrated) return;
    writeSessionValue(key, value);
  }, [key, value, hydrated]);
  return [value, setValue];
}

/** Validators. All are module-level so they are stable effect dependencies. */
export const isString = (v: unknown): v is string => typeof v === "string";
export const isNullableString = (v: unknown): v is string | null => v === null || typeof v === "string";
/** A decimal amount as typed. "" counts: clearing the field restores an empty field, not the default. */
export const isAmountString = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 20 && /^\d*\.?\d*$/.test(v);
export function isOneOf<T extends string>(allowed: readonly T[]): (v: unknown) => v is T {
  return (v: unknown): v is T => typeof v === "string" && (allowed as readonly string[]).includes(v);
}
