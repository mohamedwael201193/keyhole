"use client";
import Image from "next/image";
import type { ReactNode } from "react";
/** Premium empty/offline panel: relic emblem with a glow, title, body, actions. */
export function EmptyState({ title, body, children, tone = "signal", testid }: { title: string; body: string; children?: ReactNode; tone?: "signal" | "amber"; testid?: string }) {
  const glow = tone === "amber" ? "rgba(251,191,36,.18)" : "rgba(0,236,151,.18)";
  return (
    <section className="plate relative overflow-hidden p-8 sm:p-10" data-testid={testid}>
      <div aria-hidden="true" className="absolute inset-0" style={{ background: `radial-gradient(60% 80% at 85% 50%, ${glow}, transparent 70%)` }} />
      <div className="relative grid items-center gap-8 sm:grid-cols-[1fr_200px]">
        <div>
          <h2 className={`font-serif text-4xl ${tone === "amber" ? "text-amber-200" : ""}`}>{title}</h2>
          <p className="mt-3 max-w-lg text-zinc-300">{body}</p>
          {children && <div className="mt-6 flex flex-wrap gap-3">{children}</div>}
        </div>
        <div className="relative mx-auto aspect-square w-40 sm:w-full">
          <Image src="/art/key-live.webp" alt="" fill sizes="200px" className={`object-contain ${tone === "amber" ? "grayscale-[.6] opacity-70" : ""}`} />
        </div>
      </div>
    </section>
  );
}
