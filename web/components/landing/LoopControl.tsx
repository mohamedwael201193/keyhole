"use client";
import { Icon } from "./icons";

/** The pause control for a loop longer than five seconds. Pressed means the loop is paused. 44 px target. */
export function LoopControl({ paused, onToggle, pauseLabel, playLabel, className }: { paused: boolean; onToggle: () => void; pauseLabel: string; playLabel: string; className?: string }) {
  return (
    <button type="button" className={`lp-loopctl${className ? ` ${className}` : ""}`} aria-pressed={paused} aria-label={paused ? playLabel : pauseLabel} title={paused ? playLabel : pauseLabel} onClick={onToggle}>
      <Icon name={paused ? "play" : "pause"} size={18} />
    </button>
  );
}
