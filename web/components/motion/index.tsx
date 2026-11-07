"use client";
/* Shared visual primitives (styles in app/polish.css, prefix .khm-). Presentational only. */
import { useEffect, useState, type ReactNode } from "react";

export { FadeUp, Stagger, Parallax, Tilt, GlowReveal, CountUp } from "./primitives";

export function StepCard({ active, done, title, n, children, className = "", ...rest }:
  { active?: boolean; done?: boolean; title?: ReactNode; n?: number; children?: ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section {...rest} className={`khm-step ${active ? "is-active" : ""} ${done ? "is-done" : ""} ${className}`} aria-current={active ? "step" : undefined}>
      {(title || n) && <header className="khm-step-h">{n != null && <span className="khm-n">{done ? <SuccessCheck size={18} /> : n}</span>}{title && <h3>{title}</h3>}</header>}
      {children}
    </section>
  );
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="khm-stepper" style={{ ["--n" as string]: steps.length, ["--i" as string]: current }}>
      <span className="khm-bar" aria-hidden />
      {steps.map((s, i) => (
        <li key={s} className={i < current ? "done" : i === current ? "on" : ""} aria-current={i === current ? "step" : undefined}>
          <i aria-hidden /> <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

/** Wrap each step body; changing `k` replays the slide/fade in. */
export function StepTransition({ k, children }: { k: string | number; children: ReactNode }) {
  return <div key={k} className="khm-enter">{children}</div>;
}

export function StagedProgress({ label, startedAt, done }: { label: ReactNode; startedAt?: number; done?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (done) return; const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t); }, [done]);
  const s = startedAt ? Math.max(0, (now - startedAt) / 1000) : 0;
  return (
    <div className={`khm-prog ${done ? "done" : ""}`} role="status" aria-live="polite">
      {done ? <SuccessCheck size={18} /> : <span className="khm-spin" aria-hidden />}
      <span className="khm-prog-l">{label}</span>
      {startedAt != null && <span className="khm-prog-t">{s.toFixed(1)}s</span>}
    </div>
  );
}

export function SuccessCheck({ size = 40, label }: { size?: number; label?: string }) {
  return (
    <svg className="khm-check" width={size} height={size} viewBox="0 0 40 40" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx="20" cy="20" r="18" />
      <path d="M12 20.5l5.5 5.5L28.5 14" />
    </svg>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className={`khm-copy ${ok ? "ok" : ""}`} onClick={async () => { try { await navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 1600); } catch {} }}>
      {ok ? "Copied" : label}
    </button>
  );
}

export function QRFrame({ children, caption }: { children: ReactNode; caption?: ReactNode }) {
  return <figure className="khm-qr">{children}{caption && <figcaption>{caption}</figcaption>}</figure>;
}

/** Middle-ellipsis hash with copy icon: "a55ebb14…a80140e" [copy]. */
export function MidHash({ value, head = 8, tail = 6 }: { value: string; head?: number; tail?: number }) {
  const short = value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
  return <span className="khm-hash" title={value}><code>{short}</code><CopyButton value={value} label="⧉" /></span>;
}
