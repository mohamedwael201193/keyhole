"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { KeyCard } from "@/components/KeyCard";
import { EmptyState } from "@/components/EmptyState";
import { useI18n } from "@/lib/i18n";
import { useWallet } from "@/lib/wallet";
import { KEY_LIST_LIMIT, useKeyStore } from "@/lib/keyStore";
import { nftTier, type Token } from "@/lib/near";
import { Button, Skeleton } from "@/components/ui";

export function GalleryView({ tokens, tiers, mine = false }: { tokens: Token[]; tiers: (number | null)[]; mine?: boolean }) {
  const { t } = useI18n();
  const { accountId, connect } = useWallet();
  return (
    <div className="page gal" data-testid={mine ? "gallery-mine" : "gallery-all"}>
      <p className="eb">{t("gallery.eyebrow")}</p>
      <h1>{t("gallery.h1a")}<em>{t("gallery.h1b")}</em></h1>
      <p className="lead">{t("gallery.lead")}</p>

      <nav className="gal-filter" aria-label="Which keys to show">
        <Link href="/gallery" className={`gal-tab${mine ? "" : " on"}`} aria-current={mine ? undefined : "page"} data-testid="gallery-filter-all">All keys</Link>
        <Link href="/gallery?mine=1" className={`gal-tab${mine ? " on" : ""}`} aria-current={mine ? "page" : undefined} data-testid="gallery-filter-mine">My keys</Link>
      </nav>
      <div className="gal-bar">
        <p className="note gal-count-top">{mine ? "Keys this wallet holds, read from NEAR mainnet." : "Every key minted on NEAR mainnet."}</p>
        <Button href="/mint" testid="keys-mint">Mint a key</Button>
      </div>

      <details className="traitsx" data-testid="traits-explain">
        <summary>What the marks on a key mean</summary>
        <dl>
          <dt>Serial (6 hex characters, e.g. 020842)</dt><dd>The first six characters of the key&apos;s seed, sha256 of the contract id plus the token id. It is unique per key and is engraved on the hallmark.</dd>
          <dt>Bit cipher (8 bars, e.g. 10110010)</dt><dd>The last byte of the token id as eight bits, drawn as bars. A quick visual fingerprint; it carries no secret.</dd>
          <dt>Head, filigree, enamel, gem, shaft</dt><dd>Art traits picked from the same seed, so anyone can recompute them from the token id. They are decoration; they do not change what the key can do.</dd>
          <dt>Finish and the $ figure</dt><dd>The key&apos;s tier and its per-trade cap inside the enclave.</dd>
        </dl>
      </details>

      {mine ? <MineKeys accountId={accountId} connect={connect} /> : (
        tokens.length === 0 ? <p className="note">{t("gallery.empty")}</p> : (
          <div className="gg" data-testid="gallery">
            {tokens.map((tk, i) => <KeyCard key={tk.token_id} token={tk} tier={tiers[i]} viewer={accountId} displayIndex={i + 1} />)}
          </div>
        )
      )}

      <p className="note gal-foot"><Link href="/identity" className="gal-link">{t("gallery.toIdentity")}</Link></p>
    </div>
  );
}

/**
 * The connected account's keys, from the shared key store (mounted by components/app/AppShell.tsx). A cached list shows at once
 * and a fresh read runs behind it, so this does not look the keys up again. The store holds the first key's tier; the tiers of
 * the other keys are read in the background. Every state is said plainly: not connected, reading, unreachable, no key, or the keys.
 */
function MineKeys({ accountId, connect }: { accountId: string | null; connect: () => void }) {
  const store = useKeyStore();
  const keys = store.keys;
  const tiers = useTiers(keys.slice(1).map((tk) => tk.token_id));

  if (!accountId) {
    return (
      <EmptyState title="Sign in to see your keys" body="Your keys are read from NEAR mainnet for the account you sign in with. Reading them needs no signature." testid="gallery-mine-connect">
        <Button onClick={connect} testid="gallery-connect">Sign in</Button>
      </EmptyState>
    );
  }
  if (keys.length === 0 && (store.status === "idle" || store.status === "loading")) {
    return <div data-testid="gallery-mine-loading" aria-live="polite"><p className="note">Looking up your keys on NEAR mainnet…</p><Skeleton lines={2} /></div>;
  }
  if (keys.length === 0 && store.status === "error") {
    return (
      <EmptyState title="NEAR mainnet did not answer" body="Your keys could not be read just now. The rest of this page still works." testid="gallery-mine-error">
        <Button variant="secondary" onClick={() => store.refresh()} testid="gallery-mine-retry">Try again</Button>
      </EmptyState>
    );
  }
  if (keys.length === 0) {
    return (
      <EmptyState title="No key in this wallet yet" body="A key is the account. Minting is free and takes one signature. Only Bronze is mintable today." testid="gallery-mine-empty">
        <Button href="/mint" testid="gallery-mine-mint">Mint a key</Button>
      </EmptyState>
    );
  }
  return (
    <>
      <p className="note gal-count" data-testid="gallery-mine-count">
        {store.capped ? `Showing the first ${KEY_LIST_LIMIT} keys this wallet holds.` : `${keys.length} ${keys.length === 1 ? "key" : "keys"} in this wallet.`}
      </p>
      <div className="gg" data-testid="gallery">
        {keys.map((tk, i) => <KeyCard key={tk.token_id} token={tk} tier={i === 0 ? store.tier : (tiers[tk.token_id] ?? null)} viewer={accountId} displayIndex={i + 1} />)}
      </div>
    </>
  );
}

/** nft_tier for each id given (the keys after the first). Null while unread; a failed read stays null. Re-reads only when the ids change. */
function useTiers(ids: string[]): Record<string, number | null> {
  const [tiers, setTiers] = useState<Record<string, number | null>>({});
  const joined = ids.join(",");
  useEffect(() => {
    if (!joined) return;
    let cancel = false;
    const list = joined.split(",");
    Promise.all(list.map((id) => nftTier(id).catch(() => null))).then((ts) => {
      if (!cancel) setTiers(Object.fromEntries(list.map((id, i) => [id, ts[i]])));
    });
    return () => { cancel = true; };
  }, [joined]);
  return tiers;
}
