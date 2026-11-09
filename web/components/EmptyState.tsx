"use client";
import type { ReactNode } from "react";
import { KeyArt } from "./Art";

/**
 * Sealed-state panel used before a wallet is connected, when the enclave is offline, and when a list is empty.
 * Same KeyArt and testids as before; `icon` is optional, `tone="amber"` adds a warm edge for offline states.
 */
export function EmptyState({ title, body, children, icon, tone = "signal", testid }: { title: string; body: string; children?: ReactNode; icon?: ReactNode; tone?: "signal" | "amber"; testid?: string }) {
  // The wrapper is a size container: in a narrow column (for example the mint details card) the art stacks above the text.
  return (
    <div className="kh-empty-wrap">
      <section className={`card empty kh-empty kh-empty--${tone}`} data-testid={testid}>
        <div>
          {icon && <span className="kh-empty-icon" aria-hidden="true">{icon}</span>}
          <h2>{title}</h2>
          <p>{body}</p>
          {children && <div className="hero-actions">{children}</div>}
        </div>
        <KeyArt n={3} alt="" width={433} height={1077} />
      </section>
    </div>
  );
}
