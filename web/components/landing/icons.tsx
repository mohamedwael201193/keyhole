import type { ReactNode } from "react";

/**
 * One line-icon set for the landing: 24 px grid, 1.6 stroke, round caps, drawn in currentColor.
 * Decorative: every icon is aria-hidden; the text beside it names the thing.
 */
const PATHS = {
  shield: <><path d="M12 3 4.5 6v5.6c0 4.4 3.1 8.1 7.5 9.4 4.4-1.3 7.5-5 7.5-9.4V6L12 3Z" /><path d="m8.7 12.1 2.2 2.2 4.4-4.5" /></>,
  layers: <><path d="m12 3.5 8.5 4.2L12 12 3.5 7.7 12 3.5Z" /><path d="m3.5 12 8.5 4.2 8.5-4.2" /><path d="m3.5 16.3 8.5 4.2 8.5-4.2" /></>,
  swap: <><path d="M4 8.5h15.5M16 5l3.5 3.5L16 12" /><path d="M20 15.5H4.5M8 12l-3.5 3.5L8 19" /></>,
  coins: <><ellipse cx="12" cy="6.2" rx="7.5" ry="3" /><path d="M4.5 6.2v5.6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6.2" /><path d="M4.5 11.8v5.6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-5.6" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2.4" /><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" /><path d="M12 14.6v2.4" /></>,
  check: <path d="m5 12.8 4.4 4.4L19 7.4" />,
  key: <><circle cx="8" cy="12" r="3.8" /><path d="M11.8 12H21M17.2 12v3.2M20.6 12v2.4" /></>,
  gavel: <><path d="m13.2 4.6 4.4 4.4-3.6 3.6-4.4-4.4 3.6-3.6Z" /><path d="m11.4 10.4-6.8 6.8M3.6 20.4h8.8M7.8 14.4l2.8 2.8" /></>,
  play: <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />,
  arrow: <path d="M4.5 12h15M13.5 6l6 6-6 6" />,
  out: <path d="M7.5 16.5 16.5 7.5M8.5 7.5h8v8" />,
  x: <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />,
  user: <><circle cx="12" cy="8.6" r="3.6" /><path d="M5 20c.6-3.6 3.4-5.6 7-5.6s6.4 2 7 5.6" /></>,
  pause: <path d="M8.5 5.5v13M15.5 5.5v13" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
