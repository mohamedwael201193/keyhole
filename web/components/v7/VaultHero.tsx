import type { ReactNode } from "react";
import { Icon } from "./icons";

/**
 * The dark teal vault banner: label, the balance (serif), one plain line, the actions, and the arch art on the right
 * (public/art/arch/arch-teal.webp, drawn in CSS). `sealed` shows the balance as "Sealed" with an eye-off mark, the
 * state before a signed read. `actions` holds the buttons (for example a cream Deposit and an outline Withdraw).
 * `chip` sits top-right (the network pill is the default, "Mainnet").
 */
export type VaultHeroProps = {
  label?: string;
  /** The balance text, or "Sealed". Pass a real value only from a signed read. */
  value: ReactNode;
  sealed?: boolean;
  sub?: ReactNode;
  actions?: ReactNode;
  /** Top-right chip. Default: "Mainnet". Pass null to hide it. */
  chip?: ReactNode | null;
  valueTestId?: string;
  testid?: string;
};

export function VaultHero({ label = "Vault balance", value, sealed = false, sub, actions, chip = "Mainnet", valueTestId, testid }: VaultHeroProps) {
  return (
    <section className="v7-hero" aria-label={label} data-testid={testid}>
      <div className="v7-hero-art" aria-hidden="true" />
      <div className="v7-hero-body">
        <p className="v7-hero-label">{label}</p>
        <p className="v7-hero-value" data-testid={valueTestId}>
          <span>{value}</span>
          {sealed && <Icon name="eye-off" size={24} className="v7-hero-eye" />}
        </p>
        {sub && <p className="v7-hero-sub">{sub}</p>}
        {actions && <div className="v7-hero-actions">{actions}</div>}
      </div>
      {chip && (
        <span className="v7-hero-chip">
          <i aria-hidden="true" />
          {chip}
        </span>
      )}
    </section>
  );
}
