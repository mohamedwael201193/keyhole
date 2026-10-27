"use client";
import type { ReactNode } from "react";
import { KeyArt } from "./Art";
/** Sealed-state panel used before a wallet is connected, and when the enclave is offline. */
export function EmptyState({ title, body, children, testid }: { title: string; body: string; children?: ReactNode; tone?: "signal" | "amber"; testid?: string }) {
  return (
    <section className="card empty" data-testid={testid}>
      <div>
        <h2>{title}</h2>
        <p>{body}</p>
        {children && <div className="hero-actions">{children}</div>}
      </div>
      <KeyArt n={3} alt="" width={433} height={1077} />
    </section>
  );
}
