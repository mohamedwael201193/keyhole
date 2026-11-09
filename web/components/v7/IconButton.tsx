"use client";
import Link from "next/link";
import { Icon, type IconName } from "./icons";

/**
 * A square icon-only control, 40px. Give `label` (it becomes the accessible name and the tooltip). Pass `href` for a link,
 * or `onClick` for a button. `solid` fills it with the teal primary, for the one icon action in a row.
 */
export type IconButtonProps = {
  label: string;
  icon: IconName;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "plain" | "solid";
  testid?: string;
};

export function IconButton({ label, icon, href, onClick, disabled = false, tone = "plain", testid }: IconButtonProps) {
  const cls = `v7-icon-btn${tone === "solid" ? " solid" : ""}`;
  if (href) {
    return (
      <Link href={href} className={cls} aria-label={label} title={label} data-testid={testid}>
        <Icon name={icon} size={18} />
      </Link>
    );
  }
  return (
    <button type="button" className={cls} aria-label={label} title={label} onClick={onClick} disabled={disabled} data-testid={testid}>
      <Icon name={icon} size={18} />
    </button>
  );
}
