import type { ReactNode } from "react";

/**
 * Line icons for the v7 shell and components. 24 x 24, stroke only, drawn with currentColor. Decorative by default
 * (aria-hidden): the label next to an icon carries the meaning. Pass `label` only for an icon that stands alone.
 */
export type IconName =
  | "home" | "swap" | "vault" | "key" | "activity" | "mint"
  | "lock" | "unlock" | "eye-off" | "check" | "x" | "alert" | "info"
  | "copy" | "external" | "arrow-right" | "arrow-up-right" | "arrow-down" | "arrow-up" | "arrow-swap"
  | "chevron-right" | "chevron-down" | "shield" | "search" | "plus" | "layers" | "maximize" | "tag" | "menu" | "more";

const PATHS: Record<IconName, ReactNode> = {
  home: <path d="M3.5 10.5 12 3.5l8.5 7V20a.5.5 0 0 1-.5.5h-5v-6h-6v6H4a.5.5 0 0 1-.5-.5z" />,
  swap: <path d="M7 4v15.5M7 19.5 3.5 16M7 19.5 10.5 16M17 20V4.5M17 4.5 13.5 8M17 4.5 20.5 8" />,
  vault: <><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><circle cx="12" cy="12" r="3" /></>,
  key: <><circle cx="8" cy="12" r="3.6" /><path d="M11.6 12H21M18 12v3.2M21 12v2.4" /></>,
  activity: <path d="M3 12.5h4l2.6-6.5 4.2 13 2.6-6.5H21" />,
  mint: <path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
  unlock: <><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 7.6-1.7" /></>,
  "eye-off": <><path d="M3 3l18 18M10.6 5.2A9.6 9.6 0 0 1 12 5c4.8 0 8.4 3.6 9.6 7-.5 1.4-1.4 2.8-2.6 4M6.4 6.5C4.3 8 2.9 10 2.4 12c1.2 3.4 4.8 7 9.6 7 1.7 0 3.2-.5 4.5-1.2" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  check: <path d="M5 12.5l4.2 4.2L19 7" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  alert: <><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4.5M12 17.2v.1" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8v.1" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M5.5 15.5h-.5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5" /></>,
  external: <><path d="M14 4h6v6M20 4 10.5 13.5" /><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" /></>,
  "arrow-right": <path d="M4.5 12h15M14 6.5 19.5 12 14 17.5" />,
  "arrow-up-right": <path d="M7 17 17 7M8.5 7H17v8.5" />,
  "arrow-down": <path d="M12 4.5v15M6.5 14 12 19.5 17.5 14" />,
  "arrow-up": <path d="M12 19.5v-15M6.5 10 12 4.5 17.5 10" />,
  "arrow-swap": <path d="M7 4v15.5M7 19.5 3.5 16M7 19.5 10.5 16M17 20V4.5M17 4.5 13.5 8M17 4.5 20.5 8" />,
  "chevron-right": <path d="M9.5 6 15.5 12l-6 6" />,
  "chevron-down": <path d="M6 9.5 12 15.5l6-6" />,
  shield: <><path d="M12 3.5 19 6v5.5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  layers: <><path d="M12 4 3.5 8.5 12 13l8.5-4.5z" /><path d="m3.5 13 8.5 4.5 8.5-4.5M3.5 17.5 12 22l8.5-4.5" /></>,
  maximize: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  tag: <><path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z" /><circle cx="8" cy="8" r="1.4" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
};

export function Icon({ name, size = 20, label, className }: { name: IconName; size?: number; label?: string; className?: string }) {
  return (
    <svg
      className={className ? `v7-icon ${className}` : "v7-icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : "true"}
      role={label ? "img" : undefined}
      aria-label={label}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
