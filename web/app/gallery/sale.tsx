"use client";
import { Button } from "@/components/ui";
import { EmptyState, Skeleton } from "@/components/v7";
import type { ListingsRead } from "@/components/keys/keyData";
import type { SaleSupport } from "@/lib/sale";

/**
 * The For sale tab, when there is no list to show: the feature check, the read, the error and an empty list. The listed keys
 * themselves are drawn by the gallery grid (components/keys). Returns null when there are listings to show.
 * On a contract without the sale methods the tab says so and lists nothing; a failed check is never shown as "not supported".
 */
export function SaleListState({ support, read, retrySupport, reload }: {
  support: SaleSupport;
  read: ListingsRead;
  retrySupport: () => void;
  reload: () => void;
}) {
  if (support === "checking") return <Skeleton lines={3} testid="sale-list-checking" />;
  if (support === "v23") {
    return <EmptyState title="Selling opens with contract v2.4" body="No key can be listed or bought until the keys contract is upgraded. Every key stays where it is." testid="sale-list-v23" />;
  }
  if (support === "unknown") {
    return (
      <EmptyState title="Listings are not readable right now" body="NEAR mainnet did not answer the sale check. The rest of this page still works." testid="sale-list-unknown"
        action={<Button variant="secondary" onClick={retrySupport} testid="sale-list-retry">Try again</Button>} />
    );
  }
  if (read.status === "loading") {
    return <div data-testid="sale-list-loading" aria-live="polite"><p className="kg-note">Reading the listings from NEAR mainnet…</p><Skeleton lines={2} /></div>;
  }
  if (read.status === "error") {
    return (
      <EmptyState title="NEAR mainnet did not answer" body="The listings could not be read just now." testid="sale-list-error"
        action={<Button variant="secondary" onClick={reload} testid="sale-list-retry-read">Try again</Button>} />
    );
  }
  if (read.items.length === 0) {
    return <EmptyState title="No key is for sale right now" body="A holder lists a key from its key page. Listed keys appear here with their price." testid="sale-list-empty" />;
  }
  return null;
}
