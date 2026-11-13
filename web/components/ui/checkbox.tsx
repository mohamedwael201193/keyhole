"use client";
import { useId, type ReactNode } from "react";

/**
 * The one checkbox and the one toggle. Both replace the browser defaults and keep every native behaviour:
 *  - Checkbox is a real <input type="checkbox"> inside its <label>, so the label click, Space key, focus ring, form
 *    value and screen-reader state all come from the browser. The visible box is drawn next to it with CSS (.kh-check).
 *  - Toggle is a <button role="switch" aria-checked>, so Space and Enter flip it and a screen reader says "on" or "off".
 * Both take the visible label as `label` and an optional one-line `hint` that is tied to the control by aria-describedby.
 * Styles: app/system.css.
 */
export type CheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  id?: string;
  name?: string;
  testid?: string;
  className?: string;
  title?: string;
};

export function Checkbox({ checked, onChange, label, hint, disabled = false, id, name, testid, className, title }: CheckboxProps) {
  const auto = useId();
  const inputId = id ?? `chk-${auto}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <label className={["kh-check", disabled && "is-disabled", className].filter(Boolean).join(" ")} htmlFor={inputId} title={title}>
      <input
        id={inputId}
        name={name}
        type="checkbox"
        className="kh-check-input"
        checked={checked}
        disabled={disabled}
        aria-describedby={hintId}
        data-testid={testid}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="kh-check-box" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14" focusable="false"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <span className="kh-check-text">
        <span className="kh-check-label">{label}</span>
        {hint && <span className="kh-check-hint" id={hintId}>{hint}</span>}
      </span>
    </label>
  );
}

export type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  id?: string;
  testid?: string;
  className?: string;
};

export function Toggle({ checked, onChange, label, hint, disabled = false, id, testid, className }: ToggleProps) {
  const auto = useId();
  const base = id ?? `tgl-${auto}`;
  const hintId = hint ? `${base}-hint` : undefined;
  return (
    <div className={["kh-toggle", disabled && "is-disabled", className].filter(Boolean).join(" ")}>
      <button
        id={base}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${base}-label`}
        aria-describedby={hintId}
        disabled={disabled}
        className="kh-toggle-btn"
        data-testid={testid}
        onClick={() => onChange(!checked)}
      >
        <span className="kh-toggle-track" aria-hidden="true"><span className="kh-toggle-thumb" /></span>
      </button>
      <span className="kh-check-text">
        <span className="kh-check-label" id={`${base}-label`}>{label}</span>
        {hint && <span className="kh-check-hint" id={hintId}>{hint}</span>}
      </span>
    </div>
  );
}
