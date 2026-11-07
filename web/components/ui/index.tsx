"use client";
import { StagedProgress } from "@/components/motion";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { GLOSSARY, type Term as TermKey } from "@/lib/glossary";

export { Button, buttonClass, type ButtonProps, type ButtonSize, type ButtonVariant } from "./button";
export { Card, StatCard, type CardProps, type StatCardProps } from "./card";

/** One design system for the dense pages: badges, steps, proof drawers, spinners, skeletons, glossary terms. */

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span className="spin" role="status" aria-label={label} />;
}

export function Skeleton({ lines = 3, testid }: { lines?: number; testid?: string }) {
  return (
    <div className="sk" aria-hidden="true" data-testid={testid}>
      {Array.from({ length: lines }, (_, i) => <span key={i} style={{ width: `${92 - i * 14}%` }} />)}
    </div>
  );
}

export type Tone = "ok" | "bad" | "wait" | "info" | "warn";

/** Status words the product shows. Each maps to one tone and one plain label; the label is always printed, never colour alone. */
export const BADGE_STATUS = {
  settled: { tone: "ok", label: "Settled" },
  completed: { tone: "ok", label: "Completed" },
  success: { tone: "ok", label: "Success" },
  pending: { tone: "warn", label: "Pending" },
  refunded: { tone: "info", label: "Refunded" },
  expired: { tone: "wait", label: "Expired" },
  failed: { tone: "bad", label: "Failed" },
} as const satisfies Record<string, { tone: Tone; label: string }>;
export type BadgeStatus = keyof typeof BADGE_STATUS;

/** Tone and label for a status word (case-insensitive), or null when the word is not one of the seven. */
export function badgeFor(status: string | null | undefined): { tone: Tone; label: string } | null {
  if (!status) return null;
  const k = status.toLowerCase();
  return Object.hasOwn(BADGE_STATUS, k) ? BADGE_STATUS[k as BadgeStatus] : null;
}

/** Pass `status` alone for a known word; pass `tone` and children to override (existing callers do). */
export function Badge({ tone, children, testid, status }: { tone?: Tone; children?: ReactNode; testid?: string; status?: string }) {
  const mapped = tone ? null : badgeFor(status);
  return <span className={`ubadge ${tone ?? mapped?.tone ?? "info"}`} data-testid={testid} data-status={status}>{children ?? mapped?.label ?? status}</span>;
}

export function CopyBtn({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="ucopy" aria-label={`${label} ${value}`} onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }, () => {}); }}>
      {done ? "Copied" : label}
    </button>
  );
}

export type ProofRow = { label: string; value: string; href?: string; alt?: string; internal?: boolean };
/** Raw hashes live here, collapsed: label, value, copy, explorer (and a second explorer). */
export function Proof({ rows, title = "Proof", open = false, testid }: { rows: ProofRow[]; title?: string; open?: boolean; testid?: string }) {
  return (
    <details className="uproof" open={open} data-testid={testid ?? "proof"}>
      <summary>{title} <small>{rows.length} item{rows.length === 1 ? "" : "s"}</small></summary>
      <dl>
        {rows.map((r) => (
          <div key={r.label + r.value} className="uprow">
            <dt>{r.label}</dt>
            <dd>
              <code title={r.value}>{r.value}</code>
              <span className="upact">
                <CopyBtn value={r.value} />
                {r.href && (r.internal ? <Link className="ulink" href={r.href}>Open</Link> : <a className="ulink" href={r.href} target="_blank" rel="noreferrer">Explorer ↗</a>)}
                {r.alt && <a className="ulink alt" href={r.alt} target="_blank" rel="noreferrer" title="Second explorer, in case the first blocks your browser">Alt ↗</a>}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** Vertical stepper. Each step: number, big plain title, one action, a green "what you should see". */
export function Steps({ children, testid }: { children: ReactNode; testid?: string }) {
  return <ol className="usteps" data-testid={testid}>{children}</ol>;
}
export function Step({ n, title, children, done, testid }: { n: number; title: ReactNode; children: ReactNode; done?: boolean; testid?: string }) {
  return (
    <li className={`ustep${done ? " done" : ""}`} data-testid={testid}>
      <span className="unum" aria-hidden="true">{done ? "✓" : n}</span>
      <div className="ubody"><h2><span className="sr-only">Step {n}: </span>{title}</h2>{children}</div>
    </li>
  );
}
export function See({ children, tone = "ok" }: { children: ReactNode; tone?: "ok" | "bad" | "wait" }) {
  return <div className={`usee ${tone}`}><b>{tone === "bad" ? "Something is off" : tone === "wait" ? "Checking" : "What you should see"}</b><div>{children}</div></div>;
}

/** Plain-English definition on hover, focus or tap. */
export function Term({ k, children }: { k: TermKey; children?: ReactNode }) {
  const g = GLOSSARY[k];
  const [open, setOpen] = useState(false);
  return (
    <span className={`uterm${open ? " open" : ""}`}>
      <button type="button" className="uterm-b" aria-expanded={open} onClick={() => setOpen((v) => !v)} onBlur={() => setOpen(false)} data-testid={`term-${k}`}>{children ?? g.word}</button>
      <span role="tooltip" className="uterm-t"><b>{g.word}</b> {g.plain}</span>
    </span>
  );
}

/** Fade-and-rise when scrolled into view; instant when reduced motion is on (CSS). */
export function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Visible by default. Only content that starts below the fold is held back, and only once JS has run.
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < innerHeight * 0.92) return;
    setPending(true);
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setPending(false); io.disconnect(); } }, { rootMargin: "0px 0px -8% 0px" });
    io.observe(el); return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`ureveal${pending ? " pending" : ""} ${className}`.trim()}>{children}</div>;
}

/** The one-line purpose at the top of every page. */
export function Purpose({ eyebrow, title, line, children }: { eyebrow: string; title: ReactNode; line: ReactNode; children?: ReactNode }) {
  return (
    <header className="upurpose">
      <p className="eb">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="uline">{line}</p>
      {children}
    </header>
  );
}

/** Busy button content: spinner + stage + elapsed seconds (from useSigned().label). */
export function Busy({ l }: { l: string }) {
  // Visual from the shared motion kit (PR #105); `l` already carries the stage and elapsed seconds.
  return <span className="ubusy"><StagedProgress label={l || "Working…"} /></span>;
}
