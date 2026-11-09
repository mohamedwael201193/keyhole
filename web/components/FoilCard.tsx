import type { CSSProperties, ReactNode } from "react";
import type { Finish } from "@/lib/traits";

/** Tier metals from sketch Treatment B. */
const METAL: Record<Finish, { c1: string; c2: string }> = {
  Bronze: { c1: "#8A5A3C", c2: "#D9A57A" },
  Silver: { c1: "#6E7A80", c2: "#E4EAEE" },
  Gold: { c1: "#9A7420", c2: "#F3D27A" },
  Legendary: { c1: "#7A1F4F", c2: "#E9B44C" },
};

type Tag = "div" | "article";

/**
 * Sketch Treatment B: cream foil face, grain, a sweeping sheen, and one
 * border streak. Legendary adds the iridescent rim. Traits sit outside.
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
  return (
    <TagName
      className={`foil-card${finish === "Legendary" ? " is-leg" : ""} ${className ?? ""}`.trim()}
      data-finish={finish}
      data-t={finish === "Legendary" ? "leg" : finish.toLowerCase()}
      style={{ ...style, ["--c1" as string]: METAL[finish].c1, ["--c2" as string]: METAL[finish].c2 }}
      {...rest}
    >
      <span className="grain" aria-hidden="true" />
      <span className="foil" aria-hidden="true" />
      <div className="foil-face">{children}</div>
      <span className="bw" aria-hidden="true"><i /></span>
    </TagName>
  );
}
