import type { ReactNode } from "react";
import { acct, acctAlt, tx, txAlt } from "@/lib/config";

/** nearblocks link plus a second explorer beside it, for when nearblocks refuses the browser. */
export function TxLink({ hash, account, children, className }: { hash?: string; account?: string; children?: ReactNode; className?: string }) {
  const main = hash ? tx(hash) : acct(account!);
  const alt = hash ? txAlt(hash) : acctAlt(account!);
  const text = children ?? (hash ? `${hash.slice(0, 10)}…` : account);
  return (
    <span className={`txl ${className ?? ""}`.trim()} data-testid="txlink">
      <a href={main} target="_blank" rel="noreferrer">{text}</a>
      <a className="alt" href={alt} target="_blank" rel="noreferrer" title="Same record on a second explorer, in case nearblocks blocks your browser" aria-label="Open in a second explorer" data-testid="txlink-alt">alt ↗</a>
    </span>
  );
}
