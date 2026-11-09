"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/**
 * One row of a list: a round icon, the title and a sub line, and on the right a value and a meta line. A row with `href`
 * is a link, with `onClick` a button, otherwise plain text. The arrow shows for an interactive row.
 * Pass `iconName` for a line icon, or `icon` for your own node (a token mark, an arrow glyph).
 */
export type ListRowProps = {
  iconName?: IconName;
  icon?: ReactNode;
  /** Colour of the icon disc. */
  tone?: "success" | "warn" | "error" | "neutral" | "primary";
  title: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  meta?: ReactNode;
  href?: string;
  onClick?: () => void;
  testid?: string;
};

export function ListRow({ iconName, icon, tone = "neutral", title, sub, value, meta, href, onClick, testid }: ListRowProps) {
  const interactive = !!(href || onClick);
  const inner = (
    <>
      <span className={`v7-row-icon tone-${tone}`} aria-hidden="true">{icon ?? (iconName ? <Icon name={iconName} size={18} /> : null)}</span>
      <span className="v7-row-body">
        <span className="v7-row-title">{title}</span>
        {sub && <span className="v7-row-sub">{sub}</span>}
      </span>
      {(value || meta) && (
        <span className="v7-row-end">
          {value && <span className="v7-row-value">{value}</span>}
          {meta && <span className="v7-row-meta">{meta}</span>}
        </span>
      )}
      {interactive && <Icon name="chevron-right" size={18} className="v7-row-arrow" />}
    </>
  );
  if (href) return <Link href={href} className="v7-row" data-testid={testid}>{inner}</Link>;
  if (onClick) return <button type="button" className="v7-row" onClick={onClick} data-testid={testid}>{inner}</button>;
  return <div className="v7-row" data-testid={testid}>{inner}</div>;
}
