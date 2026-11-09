"use client";

/**
 * A joined control: one row of options in a sunken track, the chosen one raised. Controlled: pass `value` and `onChange`.
 * Use it for a short choice of views or ranges (not for filters with counts; use FilterChips for those).
 */
export type SegmentedProps<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  testid?: string;
};

export function Segmented<T extends string>({ options, value, onChange, label, testid }: SegmentedProps<T>) {
  return (
    <div className="v7-seg" role="group" aria-label={label} data-testid={testid}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" className={`v7-seg-btn${on ? " on" : ""}`} aria-pressed={on} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
