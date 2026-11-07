"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Short, dismissable notices. One provider near the root; `useToast().push({ tone, title })` anywhere below it.
 * Messages sit in a polite live region, leave on their own after a few seconds, and can be closed. Styles: app/ui.css (.kh-toasts).
 */
export type ToastTone = "ok" | "warn" | "bad" | "info";
export type ToastItem = { id: number; tone: ToastTone; title: string; body?: string };
export type ToastInput = Omit<ToastItem, "id">;

const TONE_WORD: Record<ToastTone, string> = { ok: "Done", warn: "Check", bad: "Failed", info: "Note" };
const KEEP = 3;
const LIFE_MS = 4500;

const Ctx = createContext<{ push: (t: ToastInput) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);
  const push = useCallback((t: ToastInput) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-(KEEP - 1)), { ...t, id }]);
    timers.current.set(id, setTimeout(() => dismiss(id), LIFE_MS));
  }, [dismiss]);
  useEffect(() => {
    const t = timers.current;
    return () => { t.forEach(clearTimeout); t.clear(); };
  }, []);
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <ToastList items={items} onDismiss={dismiss} />
    </Ctx.Provider>
  );
}

/** Without a provider, push does nothing, so a component can render outside the app tree (in tests). */
export function useToast(): { push: (t: ToastInput) => void } {
  return useContext(Ctx) ?? { push: () => {} };
}

/** The visible stack. Presentational, so it renders on its own. */
export function ToastList({ items, onDismiss }: { items: ToastItem[]; onDismiss?: (id: number) => void }) {
  return (
    <div className="kh-toasts" role="status" aria-live="polite" data-testid="toasts">
      {items.map((t) => (
        <div key={t.id} className={`kh-toast is-${t.tone}`} data-tone={t.tone}>
          <div className="kh-toast-text">
            <b><span className="sr-only">{TONE_WORD[t.tone]}: </span>{t.title}</b>
            {t.body && <p>{t.body}</p>}
          </div>
          {onDismiss && <button type="button" className="kh-toast-close" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>×</button>}
        </div>
      ))}
    </div>
  );
}
