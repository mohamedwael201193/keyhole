"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Dialog and bottom sheet. Traps focus inside while open, closes on Escape and on a backdrop press, locks page scroll,
 * and returns focus to the element that opened it. Renders nothing while closed. The dialog is portalled to document.body, so its
 * full-viewport backdrop is never trapped under a transformed or stacking ancestor (the page behind does not show through).
 * Styles: app/ui.css (.kh-modal-*).
 */
export const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Where focus goes on Tab inside a dialog with `count` focusable items, given the index of the focused one (-1 when focus is
 * outside). Returns the index to move to, or null to let the browser move focus on its own. Pure, so it is unit-tested.
 */
export function trapIndex(index: number, count: number, backwards: boolean): number | null {
  if (count <= 0) return null;
  if (index < 0) return backwards ? count - 1 : 0;
  if (backwards && index === 0) return count - 1;
  if (!backwards && index === count - 1) return 0;
  return null;
}

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  variant?: "dialog" | "sheet";
  testid?: string;
  /** Extra class on the panel, for a screen that needs its own width or height (for example the token picker). */
  panelClassName?: string;
};

export function Modal({ open, onClose, title, children, variant = "dialog", testid, panelClassName }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  const closer = useRef(onClose);
  // Portals need the browser. The first (server) render is inline; once mounted, the dialog moves to document.body.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const titleId = `kh-modal-${title.replace(/\W+/g, "-").toLowerCase()}`;

  useEffect(() => { closer.current = onClose; });
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    const prevRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const items = () => (panel.current ? [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)] : []);
    // A child marked data-autofocus (for example a search box) takes focus first; otherwise the first control does.
    (panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? items()[0] ?? panel.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closer.current(); return; }
      if (e.key !== "Tab") return;
      const list = items();
      const next = trapIndex(list.indexOf(document.activeElement as HTMLElement), list.length, e.shiftKey);
      if (next !== null) { e.preventDefault(); list[next]?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      document.documentElement.style.overflow = prevRootOverflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const dialog = (
    <div className={`kh-modal kh-modal--${variant}`} onMouseDown={(e) => { if (e.target === e.currentTarget) closer.current(); }} data-testid={testid}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className={panelClassName ? `kh-modal-panel ${panelClassName}` : "kh-modal-panel"} tabIndex={-1}>
        <header className="kh-modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="kh-modal-close" aria-label="Close" onClick={() => closer.current()}>
            <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </header>
        {children}
      </div>
    </div>
  );
  return mounted ? createPortal(dialog, document.body) : dialog;
}

/** A bottom sheet on phones and a centred dialog on wider screens (CSS decides the shape). */
export function Sheet(props: Omit<ModalProps, "variant">) {
  return <Modal {...props} variant="sheet" />;
}
