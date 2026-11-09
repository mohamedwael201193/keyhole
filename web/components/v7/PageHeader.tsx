import type { ReactNode } from "react";

/**
 * The page header: eyebrow (rust, uppercase), the page title in the display serif, one line of plain subtitle.
 * Put ONE italic accent phrase in the title with <em>, for example: title={<>Your <em>confidential</em> account</>}.
 * `actions` sits on the right on wide screens and wraps below the text on phones.
 */
export type PageHeaderProps = {
  eyebrow: string;
  title: ReactNode;
  /** One plain sentence under the title. */
  lead?: ReactNode;
  actions?: ReactNode;
  testid?: string;
};

export function PageHeader({ eyebrow, title, lead, actions, testid }: PageHeaderProps) {
  return (
    <header className="v7-page-head" data-testid={testid}>
      <div className="v7-page-head-text">
        <p className="v7-eyebrow">{eyebrow}</p>
        <h1 className="v7-page-title">{title}</h1>
        {lead && <p className="v7-page-lead">{lead}</p>}
      </div>
      {actions && <div className="v7-page-actions">{actions}</div>}
    </header>
  );
}
