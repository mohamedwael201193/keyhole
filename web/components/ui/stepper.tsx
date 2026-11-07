import type { ReactNode } from "react";

/**
 * Progress through a fixed sequence (for example Connect, Get key, Review, Done). Each step says its state in words,
 * so the position never depends on colour alone. Styles: app/ui.css (.kh-stepper).
 */
export type StepState = "done" | "current" | "todo";
export type StepItem = { label: ReactNode; state: StepState };

const WORD: Record<StepState, string> = { done: "done", current: "current", todo: "to do" };

export function Stepper({ steps, label = "Progress", testid }: { steps: StepItem[]; label?: string; testid?: string }) {
  return (
    <ol className="kh-stepper" aria-label={label} data-testid={testid}>
      {steps.map((s, i) => (
        <li key={i} className={`kh-step is-${s.state}`} aria-current={s.state === "current" ? "step" : undefined} data-state={s.state}>
          <span className="kh-step-dot" aria-hidden="true">{s.state === "done" ? "✓" : i + 1}</span>
          <span className="kh-step-label">{s.label}</span>
          <span className="sr-only">, {WORD[s.state]}</span>
        </li>
      ))}
    </ol>
  );
}
