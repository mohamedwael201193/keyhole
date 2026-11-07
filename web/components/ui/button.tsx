"use client";
import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

/**
 * One button for every flow. Variants: primary (3D teal), secondary (outline), ghost (text), danger (destructive; confirm steps only),
 * banner (light, on the dark green surface). Renders a <button>, or a Next <Link> when `href` is given. `loading` keeps the variant
 * colours, adds a spinner, sets aria-busy and blocks repeat presses. `icon` is a decorative icon before the label.
 * Disabled is flat grey. Styles: app/polish.css (.kh-btn) and app/ui.css (.kh-btn--danger, .kh-btn-icon).
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "banner" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and aria-busy; the button cannot be pressed again until it is cleared. */
  loading?: boolean;
  /** Text read out while loading. */
  loadingLabel?: string;
  block?: boolean;
  /** Decorative icon before the label. The label carries the meaning. */
  icon?: ReactNode;
  testid?: string;
  className?: string;
  children?: ReactNode;
};

export type ButtonProps = Common & (
  | ({ href?: undefined } & ButtonHTMLAttributes<HTMLButtonElement>)
  | ({ href: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">)
);

export function buttonClass({ variant = "primary", size = "md", block = false, className }: Pick<Common, "variant" | "size" | "block" | "className">) {
  return ["kh-btn", `kh-btn--${variant}`, size !== "md" && `kh-btn--${size}`, block && "kh-btn--block", className].filter(Boolean).join(" ");
}

export function Button(props: ButtonProps) {
  const { variant, size, loading = false, loadingLabel = "Loading", block, icon, testid, className, children, ...rest } = props as Common & Record<string, unknown>;
  const cls = buttonClass({ variant: variant as ButtonVariant, size: size as ButtonSize, block: block as boolean, className: className as string });
  const inner = (
    <>
      {loading && <span className="spin" aria-hidden="true" />}
      {loading && <span className="sr-only">{loadingLabel}</span>}
      {icon && !loading && <span className="kh-btn-icon" aria-hidden="true">{icon}</span>}
      <span className="kh-btn-label">{children}</span>
    </>
  );

  if (typeof rest.href === "string") {
    const { href, ...anchor } = rest as unknown as { href: string } & AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <Link
        {...anchor}
        href={href}
        className={cls}
        data-testid={testid}
        data-loading={loading ? "true" : undefined}
        aria-busy={loading ? true : undefined}
        aria-disabled={loading || anchor["aria-disabled"] ? true : undefined}
      >
        {inner}
      </Link>
    );
  }

  const { type = "button", disabled, ...button } = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button
      {...button}
      type={type}
      className={cls}
      disabled={disabled || loading}
      data-testid={testid}
      data-loading={loading ? "true" : undefined}
      aria-busy={loading ? true : undefined}
    >
      {inner}
    </button>
  );
}
