"use client";
import type { HTMLAttributes, ReactNode } from "react";

/**
 * Card surface: rounded 16 px (20 px large), a subtle inner border and a soft shadow.
 * `interactive` adds the hover lift. `banner` is the dark green feature surface. Styles: app/polish.css (.kh-card).
 */
export type CardProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "article" | "li";
  size?: "md" | "lg";
  tone?: "card" | "paper" | "banner";
  interactive?: boolean;
  testid?: string;
  children?: ReactNode;
};

export function Card({ as: Tag = "div", size = "md", tone = "card", interactive = false, testid, className, children, ...rest }: CardProps) {
  const cls = [
    "kh-card",
    size === "lg" && "kh-card--lg",
    tone !== "card" && `kh-card--${tone}`,
    interactive && "kh-card--interactive",
    className,
  ].filter(Boolean).join(" ");
  return <Tag {...rest} className={cls} data-testid={testid}>{children}</Tag>;
}

/**
 * One real figure with its label. The value is rendered only when one is given: pass `value` from a real source,
 * or pass `empty` (the honest state, e.g. "Sign to unseal") and no number is shown.
 */
export type StatCardProps = {
  label: ReactNode;
  value?: ReactNode;
  empty?: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "card" | "banner";
  testid?: string;
};

export function StatCard({ label, value, empty, hint, icon, tone = "card", testid }: StatCardProps) {
  const hasValue = value !== undefined && value !== null && value !== false && value !== "";
  return (
    <Card tone={tone} className="kh-stat" testid={testid} as="section" aria-label={typeof label === "string" ? label : undefined}>
      <div className="kh-stat-head">
        <span className="kh-stat-label">{label}</span>
        {icon && <span className="kh-stat-icon" aria-hidden="true">{icon}</span>}
      </div>
      {hasValue ? <span className="kh-stat-value">{value}</span> : empty ? <p className="kh-stat-empty">{empty}</p> : null}
      {hint && <p className="kh-stat-hint">{hint}</p>}
    </Card>
  );
}
