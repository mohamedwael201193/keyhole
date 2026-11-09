import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/**
 * The card surface: raised warm white, 18px radius, the soft shadow and a warm hairline edge. `flush` drops the padding
 * (for a card that holds its own rows). `tone="vault"` is the dark teal surface, for the one hero moment per page.
 */
export type CardProps = {
  as?: "section" | "div" | "article" | "aside";
  tone?: "raised" | "flush" | "vault";
  /** Adds the hover lift. Only for a card that is itself a control. */
  interactive?: boolean;
  /** Names the card for assistive tech when there is no visible heading. */
  label?: string;
  labelledBy?: string;
  testid?: string;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
};

export function Card({ as: Tag = "section", tone = "raised", interactive = false, label, labelledBy, testid, className, children, style }: CardProps) {
  const cls = ["v7-card", tone !== "raised" && `v7-card--${tone}`, interactive && "v7-card--interactive", className].filter(Boolean).join(" ");
  return (
    <Tag className={cls} aria-label={label} aria-labelledby={labelledBy} data-testid={testid} style={style}>
      {children}
    </Tag>
  );
}

/**
 * The header row of a card: serif title (optional icon before it), and on the right an optional meta text and an
 * action (a link, a button or an arrow). Give `id` and point the card's labelledBy at it.
 */
export type CardHeaderProps = {
  title: ReactNode;
  id?: string;
  icon?: IconName;
  /** Small text on the right, for example a count. */
  meta?: ReactNode;
  /** A link or button on the right. */
  action?: ReactNode;
  /** Heading level. Default 2. */
  level?: 2 | 3;
};

export function CardHeader({ title, id, icon, meta, action, level = 2 }: CardHeaderProps) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <header className="v7-card-head">
      <div className="v7-card-title">
        {icon && <span className="v7-card-icon" aria-hidden="true"><Icon name={icon} size={20} /></span>}
        <Heading id={id} className="v7-card-h">{title}</Heading>
      </div>
      {(meta || action) && (
        <div className="v7-card-side">
          {meta && <span className="v7-card-meta">{meta}</span>}
          {action}
        </div>
      )}
    </header>
  );
}
