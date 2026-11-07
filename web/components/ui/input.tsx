"use client";
import { useId, type InputHTMLAttributes, type ReactNode } from "react";

/**
 * Text field with a visible label (always), an optional hint and an error. The error is announced (role alert) and
 * linked with aria-describedby; aria-invalid is set. Styles: app/ui.css (.kh-field).
 */
export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  testid?: string;
};

export function Input({ label, hint, error, id, testid, className, ...rest }: InputProps) {
  const auto = useId();
  const fid = id ?? auto;
  const hintId = `${fid}-hint`;
  const errId = `${fid}-error`;
  const describedBy = [error ? errId : null, hint && !error ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={["kh-field", error ? "is-error" : null, className].filter(Boolean).join(" ")}>
      <label htmlFor={fid} className="kh-field-label">{label}</label>
      <input {...rest} id={fid} className="kh-field-input" aria-invalid={error ? true : undefined} aria-describedby={describedBy} data-testid={testid} />
      {hint && !error && <p id={hintId} className="kh-field-hint">{hint}</p>}
      {error && <p id={errId} className="kh-field-error" role="alert">{error}</p>}
    </div>
  );
}
