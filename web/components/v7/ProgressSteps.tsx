"use client";
import { Icon } from "./icons";

/**
 * Live steps for a multi-step action (the swap). States come from the REAL flow state, never guessed: pending (hollow),
 * active (a spinning ring, the row pulses), done (a drawn tick), error (a cross). The list is a polite live region.
 */
export type ProgressState = "pending" | "active" | "done" | "error";
export type ProgressStep = { id: string; label: string; state: ProgressState; detail?: string };

export type ProgressStepsProps = {
  steps: ProgressStep[];
  label?: string;
  testid?: string;
};

const WORD: Record<ProgressState, string> = { done: "Done", active: "In progress", error: "Failed", pending: "Waiting" };

export function ProgressSteps({ steps, label = "Progress", testid }: ProgressStepsProps) {
  return (
    <ol className="v7-progress" aria-label={label} aria-live="polite" data-testid={testid}>
      {steps.map((s) => (
        <li key={s.id} className={`v7-prog-step ${s.state}`} data-state={s.state} data-testid={testid ? `${testid}-${s.id}` : undefined}>
          <span className="v7-prog-mark" aria-hidden="true">
            {s.state === "done" && <Icon name="check" size={15} className="v7-prog-tick" />}
            {s.state === "error" && <Icon name="x" size={15} />}
            {s.state === "active" && <span className="v7-spin" />}
            {s.state === "pending" && <span className="v7-prog-dot" />}
          </span>
          <span className="v7-prog-text">
            <b>{s.label}</b>
            {s.detail && <small>{s.detail}</small>}
          </span>
          <span className="v7-sr-only">{WORD[s.state]}</span>
        </li>
      ))}
    </ol>
  );
}
