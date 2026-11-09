import { acct, tx } from "@/lib/config";
import { Icon } from "./icons";

/**
 * An explorer link as a small pill with an external-link mark. Give `hash` for a transaction or `account` for an address.
 * The text defaults to a short hash or the full account. It opens NearBlocks in a new tab. Renders nothing without a target.
 */
export type TxLinkPillProps = {
  hash?: string;
  account?: string;
  label?: string;
  testid?: string;
};

export function TxLinkPill({ hash, account, label, testid }: TxLinkPillProps) {
  const href = hash ? tx(hash) : account ? acct(account) : null;
  if (!href) return null;
  const text = label ?? (hash ? `${hash.slice(0, 8)}…` : account!);
  return (
    <a className="v7-pill-link" href={href} target="_blank" rel="noreferrer" data-testid={testid}>
      <span>{text}</span>
      <Icon name="external" size={14} />
      <span className="v7-sr-only"> (opens in a new tab)</span>
    </a>
  );
}
