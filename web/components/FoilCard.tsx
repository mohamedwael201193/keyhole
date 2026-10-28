"use client";

import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import type { Finish } from "@/lib/traits";

/** Tier metals from the approved card sketch (Treatment B + the Treatment A beam). */
const METAL: Record<Finish, { c1: string; c2: string }> = {
  Bronze: { c1: "#8A5A3C", c2: "#D9A57A" },
  Silver: { c1: "#6E7A80", c2: "#E4EAEE" },
  Gold: { c1: "#9A7420", c2: "#F3D27A" },
  Legendary: { c1: "#7A1F4F", c2: "#E9B44C" },
};

type Tag = "div" | "article";

/**
 * Holographic foil, engraved grain, a tier-metal border beam that runs at rest,
 * and a cursor tilt + glare. Legendary adds a thicker iridescent rim.
 * The sheen sits under the content so key art stays at full colour.
 */
export function FoilCard({
  finish,
  as,
  className,
  children,
  style,
  ...rest
}: {
  finish: Finish;
  as?: Tag;
  className?: string;
  children: ReactNode;
  style?: CSSProperties;
} & Omit<React.HTMLAttributes<HTMLElement>, "style" | "children" | "className">) {
  const TagName = as ?? "div";
  const ref = useRef<HTMLDivElement>(null);
  const metal = METAL[finish];

  function move(e: PointerEvent<HTMLElement>) {
    const el = ref.current;
    if (!el) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (document.documentElement.classList.contains("no-motion")) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--gx", `${(x * 100).toFixed(1)}%`);
    el.style.setProperty("--gy", `${(y * 100).toFixed(1)}%`);
    el.style.setProperty("--rx", `${((0.5 - y) * 7).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${((x - 0.5) * 9).toFixed(2)}deg`);
  }

  function leave() {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  }

  return (
    <TagName
      className={`foil-card${finish === "Legendary" ? " is-leg" : ""} ${className ?? ""}`.trim()}
      data-finish={finish}
      style={{ ...style, ["--c1" as string]: metal.c1, ["--c2" as string]: metal.c2 }}
      {...rest}
      onPointerMove={move}
      onPointerLeave={leave}
    >
      <div className="foil-tilt" ref={ref}>
        <span className="foil-grain" aria-hidden="true" />
        <span className="foil-sheen" aria-hidden="true" />
        <div className="foil-body">{children}</div>
        <span className="foil-glare" aria-hidden="true" />
        {finish === "Legendary" ? <span className="foil-rim" aria-hidden="true" /> : null}
        <span className="foil-beam" aria-hidden="true">
          <i />
          <i />
        </span>
      </div>
    </TagName>
  );
}
