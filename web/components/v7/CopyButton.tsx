"use client";
import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/copyText";
import { Icon } from "./icons";

/**
 * Copies a value to the clipboard (lib/copyText.ts, with its fallback). The icon turns into a tick for 1.6 seconds, and a
 * polite live region says "Copied" for screen readers. `label` names the action; the value is read out in the aria-label.
 */
export type CopyButtonProps = {
  value: string;
  label?: string;
  testid?: string;
  className?: string;
};

export function CopyButton({ value, label = "Copy", testid, className }: CopyButtonProps) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onClick = async () => {
    try {
      await copyText(value);
    } catch {
      return;
    }
    setDone(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), 1600);
  };

  return (
    <button
      type="button"
      className={`v7-copy${done ? " done" : ""}${className ? ` ${className}` : ""}`}
      onClick={() => void onClick()}
      aria-label={`${label} ${value}`}
      title={done ? "Copied" : label}
      data-testid={testid}
    >
      <Icon name={done ? "check" : "copy"} size={15} />
      <span className="v7-sr-only" aria-live="polite">{done ? "Copied" : ""}</span>
    </button>
  );
}
