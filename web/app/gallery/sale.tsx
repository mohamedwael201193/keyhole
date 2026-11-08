"use client";
import { useEffect, useState } from "react";
import { Button, Skeleton } from "@/components/ui";
import { EmptyState } from "@/components/EmptyState";
import { shortAccount, shortKeyId } from "@/lib/near";
import { nearText, readListings, type Listing } from "@/lib/sale";
import { useSaleSupport } from "@/lib/useSaleSupport";
import "../key/key.css";

/**
 * The For sale tab: every listed key from nft_listings, with its price and seller. Each card links to the key page, where
 * the buyer checks and the Buy button are. Feature detection first: on a contract without the sale methods the tab says so
 * and lists nothing.
 */
export function ForSale() {
  const { support, retry } = useSaleSupport();
  const [round, setRound] = useState(0);
  const [items, setItems] = useState<Listing[] | "error" | null>(null);

  useEffect(() => {
    if (support !== "open") return;
    let live = true;
    readListings(0, 100).then(
      (list) => { if (live) setItems(list); },
      () => { if (live) setItems("error"); },
    );
    return () => { live = false; };
  }, [support, round]);

  if (support === "checking") return <Skeleton lines={3} testid="sale-list-checking" />;
  if (support === "v23") {
    return <EmptyState title="Selling opens with contract v2.4" body="No key can be listed or bought until the keys contract is upgraded. Every key stays where it is." testid="sale-list-v23" />;
  }
  if (support === "unknown") {
    return (
      <EmptyState title="Listings are not readable right now" body="NEAR mainnet did not answer the sale check. The rest of this page still works." testid="sale-list-unknown">
        <Button variant="secondary" onClick={retry} testid="sale-list-retry">Try again</Button>
      </EmptyState>
    );
  }
  if (items === null) return <div data-testid="sale-list-loading" aria-live="polite"><p className="note">Reading the listings from NEAR mainnet…</p><Skeleton lines={2} /></div>;
  if (items === "error") {
    return (
      <EmptyState title="NEAR mainnet did not answer" body="The listings could not be read just now." testid="sale-list-error">
        <Button variant="secondary" onClick={() => setRound((n) => n + 1)} testid="sale-list-retry-read">Try again</Button>
      </EmptyState>
    );
  }
  if (items.length === 0) {
    return <EmptyState title="No key is for sale right now" body="A holder lists a key from its key page. Listed keys appear here with their price." testid="sale-list-empty" />;
  }
  return (
    <section data-testid="sale-list" aria-label="Keys for sale">
      <p className="note gal-count" data-testid="sale-list-count">{items.length === 1 ? "1 key for sale." : `${items.length} keys for sale.`}</p>
      <ul className="listings" data-testid="listings">
        {items.map((l) => (
          <li key={l.token_id} className="listing-card" data-testid="listing">
            <p className="listing-id">Key #{shortKeyId(l.token_id)}</p>
            <p className="listing-price" data-testid="listing-price">{nearText(l.price)} NEAR</p>
            <p className="listing-meta">Seller {shortAccount(l.seller, 6)}</p>
            <Button href={`/key?id=${encodeURIComponent(l.token_id)}`} variant="secondary" size="sm" testid="listing-view">View and buy</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
