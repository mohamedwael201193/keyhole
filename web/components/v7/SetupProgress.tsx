import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./icons";

/**
 * The setup checklist. Each item is computed by the caller from real state (done, note and action). Vertical: a list with
 * the action on the right of the open item (Overview). Horizontal: a stepper with a connecting line (Vault).
 * When every item is done and `doneText` is given, the list is replaced by that one line.
 * Each item renders data-testid="setup-<id>" and data-done="0|1".
 */
export type SetupItem = {
  id: string;
  title: string;
  note?: string;
  done: boolean;
  /**
   * The item's state is unknown because its read is still in flight — not done, and not undone either. A checking
   * item shows "…" instead of its number, and while any item is checking the count reads "Checking…" instead of a
   * number that would flicker between 3 and 5 of 5 as the reads land.
   */
  checking?: boolean;
  /** The one action for an open item. Not shown once the item is done. */
  action?: ReactNode;
};

export type SetupProgressProps = {
  items: SetupItem[];
  variant?: "vertical" | "horizontal";
  title?: string;
  headingId?: string;
  doneText?: string;
  testid?: string;
};

export function SetupProgress({ items, variant = "vertical", title = "Setup progress", headingId, doneText, testid }: SetupProgressProps) {
  const doneCount = items.filter((i) => i.done).length;
  const anyChecking = items.some((i) => i.checking);
  const allDone = doneCount === items.length;
  const firstOpen = items.findIndex((i) => !i.done);
  const stepsVar = { "--steps": items.length } as CSSProperties;
  return (
    <div className={`v7-setup v7-setup--${variant}`} data-testid={testid}>
      <div className="v7-card-head">
        <div className="v7-card-title">
          <span className="v7-card-icon" aria-hidden="true"><Icon name="layers" size={20} /></span>
          <h2 id={headingId} className="v7-card-h">{title}</h2>
        </div>
        <span className="v7-card-meta" data-testid="setup-count">{anyChecking ? "Checking…" : `${doneCount} of ${items.length}`}</span>
      </div>
      {allDone && doneText ? (
        <p className="v7-setup-done" data-testid="setup-complete"><Icon name="check" size={18} /> {doneText}</p>
      ) : variant === "vertical" ? (
        <ol className="v7-setup-list">
          {items.map((it, i) => (
            <li key={it.id} className={`v7-setup-item${it.done ? " done" : ""}`} data-testid={`setup-${it.id}`} data-done={it.done ? "1" : "0"}>
              <span className="v7-setup-mark" aria-hidden="true">{it.done ? <Icon name="check" size={15} /> : it.checking ? "…" : i + 1}</span>
              <div className="v7-setup-text">
                <b>{it.title}</b>
                {it.note && <small>{it.note}</small>}
              </div>
              {!it.done && it.action && <div className="v7-setup-action">{it.action}</div>}
            </li>
          ))}
        </ol>
      ) : (
        <ol className="v7-stepper" style={stepsVar}>
          {items.map((it, i) => {
            const state = it.done ? "done" : i === firstOpen ? "current" : "todo";
            return (
              <li key={it.id} className={`v7-step ${state}`} data-state={state} data-testid={`setup-${it.id}`} data-done={it.done ? "1" : "0"}>
                <span className="v7-step-dot" aria-hidden="true">{it.done ? <Icon name="check" size={15} /> : it.checking ? "…" : i + 1}</span>
                <span className="v7-step-label">{it.title}</span>
                {it.note && <small className="v7-step-note">{it.note}</small>}
                {!it.done && it.action && <div className="v7-step-action">{it.action}</div>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
