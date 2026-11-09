import type { ReactNode } from "react";

/**
 * A quiet empty list or unavailable state: a title, one plain sentence and at most one action. No number, no art.
 */
export type EmptyStateProps = {
  title: string;
  body: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  testid?: string;
};

export function EmptyState({ title, body, icon, action, testid }: EmptyStateProps) {
  return (
    <section className="v7-empty" data-testid={testid}>
      {icon && <span className="v7-empty-icon" aria-hidden="true">{icon}</span>}
      <h3 className="v7-empty-title">{title}</h3>
      <p className="v7-empty-body">{body}</p>
      {action && <div className="v7-empty-action">{action}</div>}
    </section>
  );
}
