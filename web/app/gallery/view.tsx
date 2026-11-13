"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { EmptyState, FilterChips, Icon, PageHeader, Skeleton, type FilterItem } from "@/components/v7";
import { KeyTile, KeyTileSkeleton } from "@/components/keys/KeyTile";
import { KeyDetails } from "@/components/keys/KeyDetails";
import { useKeyTotal, useListings, useTiersFor, useTokensFor, type SaleRead } from "@/components/keys/keyData";
import { SaleListState } from "./sale";
import { useI18n } from "@/lib/i18n";
import { useWallet } from "@/lib/wallet";
import { KEY_LIST_LIMIT, useKeyStore } from "@/lib/keyStore";
import { nftTier, nftTokens, type Token } from "@/lib/near";
import { dashHref } from "@/lib/dashboardSections";
import "@/components/keys/keys.css";

/**
 * The keys screen (/keys and /gallery). Three filters: All keys (every minted key), My keys (the signed-in account, from the
 * shared key store) and For sale (nft_listings). Search filters the visible keys by token id. Selecting a key opens its
 * KEY DETAILS panel below the grid. `serverTokens` is the first page of every key, read on the server for /gallery; /keys
 * starts on My keys and reads nothing for All until the account asks for it (then it links to /gallery).
 */
export type KeysFilter = "all" | "mine" | "sale";

type Row = { id: string; token: Token | undefined; tier: number | null | undefined };
type ReadyRow = { id: string; token: Token; tier: number | null };

export function GalleryView({ initial, serverTokens: serverTokensProp, serverTiers: serverTiersProp }: {
  initial: KeysFilter;
  serverTokens?: Token[];
  serverTiers?: (number | null)[];
}) {
  const { t } = useI18n();
  const { accountId, connect } = useWallet();
  const store = useKeyStore();
  const total = useKeyTotal();
  const sales = useListings();
  const [filter, setFilter] = useState<KeysFilter>(initial);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  // Inside the dashboard there is no server page: "All keys" reads the first page of keys here, in the browser (public views, no signature).
  const [clientAll, setClientAll] = useState<{ tokens: Token[]; tiers: (number | null)[] } | "error" | null>(null);
  const needClientAll = filter === "all" && !serverTokensProp;
  useEffect(() => {
    if (!needClientAll || clientAll) return;
    let live = true;
    nftTokens().then(async (tokens) => {
      const tiers = await Promise.all(tokens.map((tk) => nftTier(tk.token_id).catch(() => null)));
      if (live) setClientAll({ tokens, tiers });
    }).catch(() => { if (live) setClientAll("error"); });
    return () => { live = false; };
  }, [needClientAll, clientAll]);
  const serverTokens = serverTokensProp ?? (clientAll && clientAll !== "error" ? clientAll.tokens : undefined);
  const serverTiers = serverTiersProp ?? (clientAll && clientAll !== "error" ? clientAll.tiers : undefined);

  // Tiers and tokens are read only for the list on screen.
  const mineTiers = useTiersFor(filter === "mine" ? store.keys.slice(1).map((tk) => tk.token_id) : []);
  const listed = sales.read.status === "ready" ? sales.read.items : [];
  const saleIds = filter === "sale" ? listed.map((l) => l.token_id) : [];
  const saleTokens = useTokensFor(saleIds);
  const saleTiers = useTiersFor(saleIds);

  const allRows: Row[] = (serverTokens ?? []).map((tk, i) => ({ id: tk.token_id, token: tk, tier: serverTiers?.[i] ?? null }));
  const mineRows: Row[] = store.keys.map((tk, i) => ({ id: tk.token_id, token: tk, tier: i === 0 ? store.tier : mineTiers[tk.token_id] }));
  const saleRows: Row[] = listed.flatMap((l) => {
    const tk = saleTokens[l.token_id];
    if (tk === null) return [];
    return [{ id: l.token_id, token: tk, tier: saleTiers[l.token_id] }];
  });

  const rows = filter === "all" ? allRows : filter === "mine" ? mineRows : saleRows;
  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.id.toLowerCase().includes(q)) : rows;
  const ready = shown.filter((r): r is ReadyRow => !!r.token && r.tier !== undefined);
  const sel = ready.find((r) => r.id === picked) ?? ready[0] ?? null;

  /** The sale state of one key, as the tiles and the details panel show it. */
  const saleOf = (id: string): SaleRead => {
    if (sales.support === "v23" || sales.support === "unknown") return "unavailable";
    if (sales.read.status === "error") return "error";
    if (sales.read.status !== "ready") return "reading";
    return sales.read.items.find((l) => l.token_id === id) ?? null;
  };

  const mineCount = accountId && store.status === "ready" ? store.keys.length : undefined;
  const saleCount = sales.read.status === "ready" ? sales.read.items.length : undefined;
  const chips: FilterItem<KeysFilter>[] = [
    { id: "all", label: "All keys", count: total ?? undefined },
    { id: "mine", label: "My keys", count: mineCount },
    { id: "sale", label: "For sale", count: saleCount },
  ];

  function onFilter(next: KeysFilter) {
    if (next === "all" && clientAll === "error") setClientAll(null);
    setFilter(next);
    setPicked(null);
    setQuery("");
  }

  /** The state that replaces the grid (or null when the grid shows). */
  let stateBlock: ReactNode = null;
  if (filter === "mine") {
    if (!accountId) {
      stateBlock = (
        <EmptyState title="Sign in to see your keys" body="Your keys are read from NEAR mainnet for the account you sign in with. Reading them needs no signature." testid="gallery-mine-connect"
          action={<Button onClick={connect} testid="gallery-connect">Sign in</Button>} />
      );
    } else if (store.keys.length === 0 && (store.status === "idle" || store.status === "loading")) {
      stateBlock = <div data-testid="gallery-mine-loading" aria-live="polite"><p className="kg-note">Looking up your keys on NEAR mainnet…</p><Skeleton lines={2} /></div>;
    } else if (store.keys.length === 0 && store.status === "error") {
      stateBlock = (
        <EmptyState title="NEAR mainnet did not answer" body="Your keys could not be read just now. The rest of this page still works." testid="gallery-mine-error"
          action={<Button variant="secondary" onClick={() => store.refresh()} testid="gallery-mine-retry">Try again</Button>} />
      );
    } else if (store.keys.length === 0) {
      stateBlock = (
        <EmptyState title="No key in this wallet yet" body="A key is the account. Minting is free and takes one signature. Only Bronze is mintable today." testid="gallery-mine-empty"
          action={<Button href={dashHref("/mint")} testid="gallery-mine-mint">Mint a key</Button>} />
      );
    }
  } else if (filter === "all") {
    if (!serverTokens && clientAll === "error") {
      stateBlock = (
        <EmptyState title="NEAR mainnet did not answer" body="The list of keys could not be read just now." testid="gallery-all-error"
          action={<Button variant="secondary" onClick={() => setClientAll(null)} testid="gallery-all-retry">Try again</Button>} />
      );
    } else if (!serverTokens) {
      stateBlock = <div data-testid="gallery-all-loading" aria-live="polite"><p className="kg-note">Reading the keys minted on NEAR mainnet…</p><Skeleton lines={2} /></div>;
    } else if (serverTokens.length === 0) {
      stateBlock = <EmptyState title="No keys yet" body={t("gallery.empty")} testid="gallery-empty" />;
    }
  } else {
    stateBlock = <SaleListState support={sales.support} read={sales.read} retrySupport={sales.retrySupport} reload={sales.reload} />;
  }

  let countLine: ReactNode = null;
  if (filter === "all" && serverTokens) {
    countLine = total != null && total > serverTokens.length
      ? <p className="kg-count" data-testid="gallery-count">Showing the first {serverTokens.length} of {total} keys minted on NEAR mainnet.</p>
      : <p className="kg-count" data-testid="gallery-count">{serverTokens.length === 1 ? "1 key" : `${serverTokens.length} keys`} minted on NEAR mainnet.</p>;
  } else if (filter === "mine" && store.keys.length > 0) {
    countLine = (
      <p className="kg-count" data-testid="gallery-mine-count">
        {store.capped ? `Showing the first ${KEY_LIST_LIMIT} keys this wallet holds.` : `${store.keys.length} ${store.keys.length === 1 ? "key" : "keys"} in this wallet.`}
      </p>
    );
  } else if (filter === "sale" && sales.read.status === "ready" && sales.read.items.length > 0) {
    countLine = <p className="kg-count" data-testid="sale-list-count">{sales.read.items.length === 1 ? "1 key for sale." : `${sales.read.items.length} keys for sale.`}</p>;
  }

  const showGrid = !stateBlock && rows.length > 0;

  return (
    <div className="kp-root kg-root" data-testid={`gallery-${filter}`}>
      <PageHeader
        eyebrow="Gallery"
        title={<>Every key is <em>one of one.</em></>}
        lead={t("gallery.lead")}
        testid="gallery-head"
      />

      <div className="kg-toolbar">
        <FilterChips items={chips} value={filter} onChange={onFilter} label="Which keys to show" testid="gallery-filter" />
        <label className="kg-search">
          <span className="v7-sr-only">Search by token id</span>
          <Icon name="search" size={18} className="kg-search-icon" />
          <input
            type="search"
            className="kg-input"
            placeholder="Search by token id…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            data-testid="gallery-search"
          />
        </label>
        {store.keys.length > 0 ? <Button href={dashHref(`/key?id=${encodeURIComponent(store.keys[0].token_id)}`)} icon={<Icon name="key" size={18} />} testid="keys-mint">View your key</Button> : <Button href={dashHref("/mint")} icon={<Icon name="plus" size={18} />} testid="keys-mint">Mint a key</Button>}
      </div>

      {stateBlock}
      {showGrid && countLine}
      {showGrid && shown.length === 0 && (
        <EmptyState title="No key matches" body={<>No key id contains “{query.trim()}”.</>} testid="gallery-no-match"
          action={<Button variant="secondary" onClick={() => setQuery("")} testid="gallery-clear">Clear search</Button>} />
      )}
      {showGrid && shown.length > 0 && (
        <div className="kg-grid" data-testid={filter === "sale" ? "sale-list" : "gallery"}>
          {shown.map((r, i) => (
            r.token && r.tier !== undefined ? (
              <KeyTile
                key={r.id}
                token={r.token}
                tier={r.tier}
                index={i + 1}
                viewer={accountId}
                sale={saleOf(r.id)}
                selected={sel?.id === r.id}
                onSelect={() => setPicked(r.id)}
              />
            ) : <KeyTileSkeleton key={r.id} />
          ))}
        </div>
      )}
      {sel && (
        <KeyDetails
          tokenId={sel.id}
          owner={sel.token.owner_id}
          tier={sel.tier}
          viewer={accountId}
          sale={saleOf(sel.id)}
          proofHref={`/key?id=${encodeURIComponent(sel.id)}`}
          saleHref={`/key?id=${encodeURIComponent(sel.id)}#sale-card`}
        />
      )}

      <details className="kg-explain" data-testid="traits-explain">
        <summary>What the marks on a key mean</summary>
        <dl>
          <dt>Serial (6 hex characters, e.g. 020842)</dt><dd>The first six characters of the key&apos;s seed, sha256 of the contract id plus the token id. It is unique per key and is engraved on the hallmark.</dd>
          <dt>Bit cipher (8 bars, e.g. 10110010)</dt><dd>The last byte of the token id as eight bits, drawn as bars. A quick visual fingerprint; it carries no secret.</dd>
          <dt>Head, filigree, enamel, gem, shaft</dt><dd>Art traits picked from the same seed, so anyone can recompute them from the token id. They are decoration; they do not change what the key can do.</dd>
          <dt>Finish and the $ figure</dt><dd>The key&apos;s tier and its per-trade cap inside the enclave.</dd>
        </dl>
      </details>

      <p className="kg-foot"><Link href="/identity" className="kg-link">{t("gallery.toIdentity")}</Link></p>
    </div>
  );
}
