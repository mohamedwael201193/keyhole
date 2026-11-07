"use client";
import { useId, type ReactNode } from "react";
import { Button } from "./button";

/**
 * The amount a user types: one large number, the token symbol, a Max button, the balance and a USD sub-line.
 * `usd` and `balance` are shown only when a real figure is passed; an error is announced under the field.
 * Styles: app/ui.css (.kh-amount).
 */
export type AmountInputProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  symbol: string;
  /** Formatted balance, for example "12.50 USDC". Shown only when given. */
  balance?: string;
  /** Formatted USD sub-line, for example "about $12.50". Shown only when given. */
  usd?: string;
  /** Called by the Max button. The button is hidden when this is not given. */
  onMax?: () => void;
  error?: string | null;
  disabled?: boolean;
  placeholder?: string;
  testid?: string;
  /** Extra content on the right of the field (for example a TokenSelect trigger). */
  end?: ReactNode;
};

/** Accepts a plain decimal: digits and at most one dot. Anything else is dropped as it is typed. */
export function cleanAmount(v: string): string {
  const s = v.replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const [whole, ...rest] = s.split(".");
  return rest.length ? `${whole}.${rest.join("")}` : whole;
}

export function AmountInput({ label, value, onChange, symbol, balance, usd, onMax, error, disabled, placeholder = "0", testid, end }: AmountInputProps) {
  const id = useId();
  const errId = `${id}-error`;
  return (
    <div className={`kh-amount${error ? " is-error" : ""}${disabled ? " is-disabled" : ""}`} data-testid={testid}>
      <div className="kh-amount-top">
        <label htmlFor={id} className="kh-amount-label">{label}</label>
        {balance && <span className="kh-amount-balance">Balance {balance}</span>}
      </div>
      <div className="kh-amount-row">
        <input
          id={id}
          className="kh-amount-input"
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          onChange={(e) => onChange(cleanAmount(e.target.value))}
        />
        <span className="kh-amount-symbol">{symbol}</span>
        {onMax && <Button variant="ghost" size="sm" onClick={onMax} disabled={disabled} testid={testid ? `${testid}-max` : undefined}>Max</Button>}
        {end}
      </div>
      {usd && <p className="kh-amount-usd">{usd}</p>}
      {error && <p id={errId} className="kh-field-error" role="alert">{error}</p>}
    </div>
  );
}
