import type { ReactNode } from "react";

/**
 * A quiet empty list or unavailable state: a title, one plain sentence and at most one action. No art, no number.
 * The sealed key panel for the vault and keys lives in components/EmptyState.tsx. Styles: app/ui.css (.kh-empty-state).
 */
export function EmptyState({ title, body, icon, children, testid }: { title: string; body: ReactNode; icon?: ReactNode; children?: ReactNode; testid?: string }) {
  return (
    <section className="kh-empty-state" data-testid={testid}>
      {icon && <span className="kh-empty-state-icon" aria-hidden="true">{icon}</span>}
      <h3>{title}</h3>
      <p>{body}</p>
      {children && <div className="kh-empty-state-actions">{children}</div>}
    </section>
  );
}
