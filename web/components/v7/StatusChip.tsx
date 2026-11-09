import type { ReactNode } from "react";
import { Icon } from "./icons";

/**
 * A status word with its tone. The label is always printed (never colour alone).
 * tone: success (settled, live, verified), warn (pending, refunded), error (failed, down), neutral (anything else), info.
 * icon: "dot" (default), "check", "alert", or "none".
 */
export type StatusTone = "success" | "warn" | "error" | "neutral" | "info";

export type StatusChipProps = {
  tone?: StatusTone;
  icon?: "dot" | "check" | "alert" | "none";
  children: ReactNode;
  testid?: string;
};

export function StatusChip({ tone = "neutral", icon = "dot", children, testid }: StatusChipProps) {
  return (
    <span className={`v7-chip v7-chip--${tone}`} data-tone={tone} data-testid={testid}>
      {icon === "dot" && <i aria-hidden="true" />}
      {icon === "check" && <Icon name="check" size={14} />}
      {icon === "alert" && <Icon name="alert" size={14} />}
      <span>{children}</span>
    </span>
  );
}
