"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { KeyCard } from "@/components/KeyCard";
import { EmptyState } from "@/components/EmptyState";
import { useI18n } from "@/lib/i18n";
import { useWallet } from "@/lib/wallet";
import { useMyKeys, KEY_LIST_LIMIT, type MyKeys } from "@/lib/useMyKeys";
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
 * The connected account's keys, read from NEAR mainnet with public views (nft_tokens_for_owner, nft_tier): no signature.
 * Every state is said plainly: not connected, reading, unreachable, no key yet, or the keys.
 */
function MineKeys({ accountId, connect }: { accountId: string | null; connect: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const mk: MyKeys = useMyKeys(accountId, attempt);
  const tiers = useTiers(mk);

  if (!accountId) {
    return (
      <EmptyState title="Sign in to see your keys" body="Your keys are read from NEAR mainnet for the account you sign in with. Reading them needs no signature." testid="gallery-mine-connect">
        <Button onClick={connect} testid="gallery-connect">Sign in</Button>
      </EmptyState>
    );
  }
  if (mk.status === "idle" || mk.status === "loading" || mk.accountId !== accountId) {
    return <div data-testid="gallery-mine-loading" aria-live="polite"><p className="note">Looking up your keys on NEAR mainnet…</p><Skeleton lines={2} /></div>;
  }
  if (mk.status === "error") {
    return (
      <EmptyState title="NEAR mainnet did not answer" body="Your keys could not be read just now. The rest of this page still works." testid="gallery-mine-error">
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)} testid="gallery-mine-retry">Try again</Button>
      </EmptyState>
    );
  }
  if (mk.tokens.length === 0) {
    return (
      <EmptyState title="No key in this wallet yet" body="A key is the account. Minting is free and takes one signature. Only Bronze is mintable today." testid="gallery-mine-empty">
        <Button href="/mint" testid="gallery-mine-mint">Mint a key</Button>
      </EmptyState>
    );
  }
  return (
    <>
      <p className="note gal-count" data-testid="gallery-mine-count">
        {mk.tokens.length >= KEY_LIST_LIMIT ? `Showing the first ${KEY_LIST_LIMIT} keys this wallet holds.` : `${mk.tokens.length} ${mk.tokens.length === 1 ? "key" : "keys"} in this wallet.`}
      </p>
      <div className="gg" data-testid="gallery">
        {mk.tokens.map((tk, i) => <KeyCard key={tk.token_id} token={tk} tier={tiers[tk.token_id] ?? null} viewer={accountId} displayIndex={i + 1} />)}
      </div>
    </>
  );
}

/** nft_tier for each key in the list (useMyKeys reads only the first). Null while unread; a failed read stays null. */
function useTiers(mk: MyKeys): Record<string, number | null> {
  const [tiers, setTiers] = useState<Record<string, number | null>>({});
  useEffect(() => {
    if (mk.status !== "ready") return;
    let cancel = false;
    Promise.all(mk.tokens.map((tk) => nftTier(tk.token_id).catch(() => null))).then((ts) => {
      if (!cancel) setTiers(Object.fromEntries(mk.tokens.map((tk, i) => [tk.token_id, ts[i]])));
    });
    return () => { cancel = true; };
  }, [mk.status, mk.tokens]);
  return tiers;
}
