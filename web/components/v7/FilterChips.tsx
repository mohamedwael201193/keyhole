"use client";

/**
 * Pill filters with an optional count, for example All 24 / Settled 18. One is active (teal). Controlled: pass `value` and
 * `onChange`. Counts are the caller's real numbers; pass none to hide the count.
 */
export type FilterItem<T extends string> = { id: T; label: string; count?: number };
export type FilterChipsProps<T extends string> = {
  items: FilterItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Names the group for assistive tech. */
  label: string;
  testid?: string;
};

export function FilterChips<T extends string>({ items, value, onChange, label, testid }: FilterChipsProps<T>) {
  return (
    <div className="v7-filters" role="group" aria-label={label} data-testid={testid}>
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            className={`v7-filter${on ? " on" : ""}`}
            aria-pressed={on}
            onClick={() => onChange(it.id)}
            data-testid={testid ? `${testid}-${it.id}` : undefined}
          >
            <span>{it.label}</span>
            {it.count !== undefined && <span className="v7-filter-count">{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
