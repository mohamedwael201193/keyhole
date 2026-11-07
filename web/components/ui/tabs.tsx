"use client";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

/**
 * Tab strip with the WAI-ARIA pattern: arrow keys, Home and End move and select; only the selected tab is in the tab order.
 * The parent renders the matching panel (role="tabpanel", id `${id}-panel`). Styles: app/ui.css (.kh-tabs).
 */
export type TabItem = { id: string; label: ReactNode };

/** The index a key press moves to, or null when the key does nothing here. Pure, so it is unit-tested. */
export function nextTabIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight": case "ArrowDown": return (current + 1) % count;
    case "ArrowLeft": case "ArrowUp": return (current - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}

export function Tabs({ items, value, onChange, label, id = "tabs", testid }: { items: TabItem[]; value: string; onChange: (id: string) => void; label: string; id?: string; testid?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = nextTabIndex(index, e.key, items.length);
    if (next === null) return;
    e.preventDefault();
    onChange(items[next].id);
    refs.current[next]?.focus();
  }
  return (
    <div role="tablist" aria-label={label} className="kh-tabs" data-testid={testid}>
      {items.map((it, i) => {
        const selected = it.id === value;
        return (
          <button
            key={it.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={`${id}-tab-${it.id}`}
            aria-selected={selected}
            aria-controls={`${id}-panel`}
            tabIndex={selected ? 0 : -1}
            className={`kh-tab${selected ? " on" : ""}`}
            onClick={() => onChange(it.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
