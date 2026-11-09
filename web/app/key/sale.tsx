"use client";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Button, Skeleton } from "@/components/ui";
import { Card } from "@/components/ui/card";
import { TxResult } from "@/components/TxResult";
import { TxLink } from "@/components/TxLink";
import { useWallet } from "@/lib/wallet";
import { useKeyStore } from "@/lib/keyStore";
import { shortAccount, tierName, view, type Token } from "@/lib/near";
import { formatUsdMicro } from "@/lib/amount";
import { ageLabel } from "@/lib/keyProof";
import { fetchKeyRecord, verifyKeyRecord, type RecordFetch, type RecordReport } from "@/lib/keyRecord";
import { KEYS_CONTRACT } from "@/lib/config";
import { GAS_BUY, GAS_LIST, ONE_YOCTO, type KeysCall, type SendResult, type TxError } from "@/lib/keysTx";
import { accountState } from "@/lib/nearAccount";
import { useSaleSupport } from "@/lib/useSaleSupport";
import {
  LIST_DEPOSIT_YOCTO, buyBlockReason, isHolder, listBlockReason, nearText, parsePriceNear, readListing, royaltyOf,
  royaltyPercentText, sellerNetOf, type Listing,
} from "@/lib/sale";

type Act = "list" | "update" | "unlist" | "buy";
const TITLE: Record<Act, string> = {
  list: "Listing confirmed on NEAR",
  update: "New price confirmed on NEAR",
  unlist: "Listing ended on NEAR",
  buy: "Purchase confirmed on NEAR",
};
const BUSY: Record<Act, string> = { list: "Confirm the listing", update: "Confirm the new price", unlist: "Confirm the unlist", buy: "Confirm the purchase" };
/** The one line the enclave's freeze is stated with, on every listed key. */
const FREEZE_NOTE = "While listed, the enclave freezes withdrawals and swaps on this key.";

type Props = {
  /** The key id (the contract's token id). */
  id: string;
  /** The holder on chain, or undefined while it is read. */
  owner: string | null | undefined;
  /** The contract's royalty in basis points, or undefined/null when not read. */
  royaltyBps: number | null | undefined;
  /** The minter the contract names, read by the key page. undefined while reading, null when unavailable. */
  minter: string | null | undefined;
  /** Re-reads the holder and the royalty (the key page owns those reads). */
  onChanged: () => void;
};

/**
 * The sale card on /key. Holder: list, change the price, unlist. Anyone else: the price and seller of a listed key, the
 * link to the buyer checks, and Buy. Each button runs one real contract call through lib/keysTx.ts; the result is shown as
 * a TxResult with its NEAR link, then the listing, the holder and the key store are read again. Feature detection hides the
 * actions on a contract that predates v2.4.
 */
export function SaleCard({ id, owner, royaltyBps, minter, onChanged }: Props) {
  const { accountId, connect, sendTx } = useWallet();
  const store = useKeyStore();
  const { support, retry: retrySupport } = useSaleSupport();
  const [round, setRound] = useState(0);
  const [lst, setLst] = useState<{ id: string; value: Listing | null; error: boolean } | null>(null);
  /** The signed-in account's NEAR, read fresh: undefined while reading, null when the read failed. Needed to list. */
  const [bal, setBal] = useState<{ account: string; yocto: bigint | null } | null>(null);
  const [busy, setBusy] = useState<Act | null>(null);
  const [tx, setTx] = useState<{ act: Act | null; hash: string | null; redirect: boolean; error: TxError | null } | null>(null);
  const [price, setPrice] = useState("");
  const [formErr, setFormErr] = useState<string | null>(null);

  // The listing, read fresh. Changing id or a round (after a transaction) reads it again.
  useEffect(() => {
    let live = true;
    readListing(id).then(
      (value) => { if (live) setLst({ id, value, error: false }); },
      () => { if (live) setLst({ id, value: null, error: true }); },
    );
    return () => { live = false; };
  }, [id, round]);

  // A new key starts with no result, no typed price and no form error. Declared before the wallet-return read below.
  useEffect(() => { setTx(null); setFormErr(null); setPrice(""); }, [id]);

  // The account's NEAR balance, read when it signs in and again after each transaction (round).
  useEffect(() => {
    if (!accountId) { setBal(null); return; }
    let live = true;
    accountState(accountId).then((s) => { if (live) setBal({ account: accountId, yocto: s ? s.yocto : null }); });
    return () => { live = false; };
  }, [accountId, round]);

  // A browser wallet returns here with the hash in the URL. The URL is cleaned once the hash is taken.
  useEffect(() => {
    const url = new URL(location.href);
    const hash = url.searchParams.get("transactionHashes")?.split(",")[0];
    if (!hash) return;
    url.searchParams.delete("transactionHashes");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    setTx({ act: null, hash, redirect: false, error: null });
    setRound((n) => n + 1);
  }, [id]);

  const cur = lst && lst.id === id ? lst : null;
  const listed = cur?.value ?? null;
  const signedIn = !!accountId;
  const holder = isHolder(accountId, owner);
  const holdsKey = store.keys.length > 0;
  const keysLoading = signedIn && store.keys.length === 0 && (store.status === "idle" || store.status === "loading");
  const sellerIsMe = !!listed && !!accountId && listed.seller === accountId;

  function reload() {
    setRound((n) => n + 1);
    onChanged();
    // The RPC can trail the wallet by a block. A second read catches that.
    setTimeout(() => { setRound((n) => n + 1); onChanged(); }, 2500);
  }

  async function send(act: Act, call: KeysCall) {
    setBusy(act); setTx(null);
    let r: SendResult;
    try { r = await sendTx(call); } catch {
      r = { error: { code: "unknown", message: "The transaction did not complete. Nothing is confirmed on NEAR." } };
    }
    setBusy(null);
    if ("txHash" in r) {
      // A buy on a listing that ended in the meantime succeeds on chain without a sale (the contract refunds the buyer and
      // emits key_listing_stale), so the result is only a purchase if the key is now ours.
      if (act === "buy" && accountId) {
        // A fresh read (not the shared 60 s cache): the owner must be the one after this transaction.
        const owner = await view<Token | null>("nft_token", { token_id: id }, KEYS_CONTRACT, { shared: false }).then((t) => t?.owner_id ?? null).catch(() => undefined);
        if (owner !== undefined && owner !== accountId) {
          setTx({ act, hash: r.txHash, redirect: false, error: { code: "stale_listing", message: "The listing had already ended, so no sale happened. Your NEAR was refunded in the same transaction." } });
          reload(); return;
        }
      }
      setTx({ act, hash: r.txHash, redirect: false, error: null }); reload(); return;
    }
    if ("redirect" in r) { setTx({ act, hash: null, redirect: true, error: null }); return; }
    setTx({ act, hash: null, redirect: false, error: r.error });
  }

  function onList(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const p = parsePriceNear(price);
    if (!p.ok) { setFormErr(p.reason); return; }
    setFormErr(null);
    void send("list", { method: "nft_list", args: { token_id: id, price: p.yocto.toString() }, deposit: LIST_DEPOSIT_YOCTO.toString(), gas: GAS_LIST });
  }

  function onUpdate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const p = parsePriceNear(price);
    if (!p.ok) { setFormErr(p.reason); return; }
    setFormErr(null);
    // The same seller changes the price with exactly 1 yoctoNEAR; the deposit stays with the listing.
    void send("update", { method: "nft_list", args: { token_id: id, price: p.yocto.toString() }, deposit: ONE_YOCTO, gas: GAS_LIST });
  }

  function onBuy() {
    if (!listed) return;
    void send("buy", { method: "nft_buy", args: { token_id: id }, deposit: listed.price, gas: GAS_BUY });
  }

  const shell = (body: ReactNode, title = "Sale") => (
    <Card as="section" className="sale-card" testid="sale-card" aria-labelledby="sale-h">
      <p className="eb">Sale · NEAR mainnet</p>
      <h2 id="sale-h">{title}</h2>
      {body}
    </Card>
  );

  if (support === "checking") {
    return shell(<Skeleton lines={2} testid="sale-checking" />);
  }
  if (support === "v23") {
    return shell(
      <>
        <p className="sale-say" data-testid="sale-v23">Selling opens with contract v2.4.</p>
        <p className="note">Listing and buying are off until the keys contract is upgraded. Nothing on this key has changed.</p>
      </>,
    );
  }
  if (support === "unknown") {
    return shell(
      <>
        <p className="sale-say" data-testid="sale-unknown">The sale status is not readable right now.</p>
        <div className="sale-actions"><Button variant="secondary" size="sm" onClick={retrySupport} testid="sale-retry">Try again</Button></div>
      </>,
    );
  }

  // Support is open: the listing is the next thing to read.
  if (!cur) return shell(<Skeleton lines={2} testid="sale-reading" />);
  if (cur.error) {
    return shell(
      <>
        <p className="sale-say" data-testid="sale-read-error">The listing could not be read from NEAR just now.</p>
        <div className="sale-actions"><Button variant="secondary" size="sm" onClick={() => setRound((n) => n + 1)} testid="sale-read-retry">Try again</Button></div>
      </>,
    );
  }

  const result = tx ? (
    <TxResult
      state={tx.hash ? "confirmed" : tx.redirect ? "pending" : "failed"}
      hash={tx.hash ?? undefined}
      title={tx.redirect ? "Your wallet opened its own page" : tx.act ? TITLE[tx.act] : "Transaction from your wallet"}
      reason={tx.error?.message}
      testid="sale-result"
    >
      {tx.redirect && <p className="note">The result comes back to this page when the wallet finishes.</p>}
    </TxResult>
  ) : null;

  const priceErr = formErr ? <p className="note key-error" role="alert" data-testid="sale-form-error">{formErr}</p> : null;

  // Listed.
  if (listed) {
    const priceNear = nearText(listed.price);
    const updateBlock = !signedIn ? "Sign in with the wallet that holds this key." : !sellerIsMe ? "Only the seller can change the price." : null;
    const buyReason = buyBlockReason({ signedIn, accountId, owner, listing: listed, holdsKey, keysLoading });
    const busyAny = busy !== null;
    return shell(
      <>
        <dl className="kb-grid sale-facts">
          <div>
            <dt>Price</dt>
            <dd data-testid="sale-current-price">{priceNear} NEAR</dd>
          </div>
          <div>
            <dt>Seller</dt>
            <dd><span className="mono"><TxLink account={listed.seller}>{shortAccount(listed.seller, 6)}</TxLink></span></dd>
          </div>
        </dl>

        <SignedRecord listing={listed} owner={owner} minter={minter} />

        {holder ? (
          <>
            {sellerIsMe ? (
              <form className="sale-form" onSubmit={onUpdate} data-testid="sale-update-form">
                <label className="sale-field">
                  <span>New price (NEAR)</span>
                  <input className="input" inputMode="decimal" autoComplete="off" spellCheck={false} value={price} placeholder={priceNear}
                    onChange={(e) => setPrice(e.target.value)} data-testid="sale-price" aria-describedby="sale-form-note" />
                </label>
                {priceErr}
                <div className="sale-actions">
                  <Button type="submit" variant="primary" disabled={busyAny || !!updateBlock} loading={busy === "update"} loadingLabel={BUSY.update} testid="sale-update">Update price</Button>
                  <Button variant="secondary" disabled={busyAny} loading={busy === "unlist"} loadingLabel={BUSY.unlist} onClick={() => void send("unlist", { method: "nft_unlist", args: { token_id: id }, deposit: ONE_YOCTO, gas: GAS_LIST })} testid="sale-unlist">Unlist</Button>
                </div>
                {updateBlock && <p className="note" data-testid="sale-update-reason">{updateBlock}</p>}
              </form>
            ) : (
              <>
                <p className="sale-say">This listing was made by an earlier holder. Unlist it to take it off sale.</p>
                <div className="sale-actions">
                  <Button variant="secondary" disabled={busyAny} loading={busy === "unlist"} loadingLabel={BUSY.unlist} onClick={() => void send("unlist", { method: "nft_unlist", args: { token_id: id }, deposit: ONE_YOCTO, gas: GAS_LIST })} testid="sale-unlist">Unlist</Button>
                </div>
              </>
            )}
            <p className="note">{FREEZE_NOTE}</p>
          </>
        ) : (
          <>
            <p className="note"><a className="sale-link" href="#before-buy" data-testid="sale-check">Check before you buy</a></p>
            <div className="sale-actions">
              {signedIn ? (
                <Button variant="primary" disabled={busyAny || !!buyReason} loading={busy === "buy"} loadingLabel={BUSY.buy} onClick={onBuy} testid="sale-buy">
                  {`Buy for ${priceNear} NEAR`}
                </Button>
              ) : (
                <Button variant="secondary" onClick={connect} testid="sale-signin">Sign in to buy</Button>
              )}
            </div>
            {buyReason && <p className="note" data-testid="sale-buy-reason">{buyReason}</p>}
            {!buyReason && <p className="note">Buying sends exactly {priceNear} NEAR. The royalty goes to the treasury; the rest goes to the seller.</p>}
          </>
        )}

        {result}
      </>,
      "For sale",
    );
  }

  // Not listed.
  if (holder) {
    const bps = royaltyBps;
    const readyForPrice = bps != null;
    const p = parsePriceNear(price);
    const balance = bal && bal.account === accountId ? bal.yocto : undefined;
    const block = listBlockReason({ signedIn, accountId, owner, royaltyBps, balance });
    const priceYocto = p.ok ? p.yocto : null;
    return shell(
      <>
        <form className="sale-form" onSubmit={onList} data-testid="sale-list-form">
          <label className="sale-field">
            <span>Price (NEAR)</span>
            <input className="input" inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="5" value={price}
              onChange={(e) => setPrice(e.target.value)} data-testid="sale-price" aria-describedby="sale-form-note" />
          </label>
          {priceErr}
          {readyForPrice && priceYocto != null && bps != null ? (
            <dl className="kb-grid sale-facts" id="sale-form-note" data-testid="sale-breakdown">
              <div>
                <dt>Royalty to the treasury</dt>
                <dd data-testid="sale-royalty">{nearText(royaltyOf(priceYocto, bps))} NEAR ({royaltyPercentText(bps)})</dd>
              </div>
              <div>
                <dt>You receive on sale</dt>
                <dd data-testid="sale-receive">{nearText(sellerNetOf(priceYocto, bps))} NEAR</dd>
              </div>
              <div>
                <dt>Listing deposit</dt>
                <dd>0.01 NEAR, returned to you when the listing ends</dd>
              </div>
            </dl>
          ) : (
            <p className="note" id="sale-form-note">{block ?? "Enter a price to see the royalty and what you receive."}</p>
          )}
          {block && priceYocto != null && <p className="note" data-testid="sale-list-reason">{block}</p>}
          <p className="note">{FREEZE_NOTE}</p>
          <div className="sale-actions">
            <Button type="submit" variant="primary" disabled={busy !== null || !!block || !p.ok} loading={busy === "list"} loadingLabel={BUSY.list} testid="sale-list">List for sale</Button>
          </div>
        </form>
        {result}
      </>,
      "Sell this key",
    );
  }

  return shell(
    <>
      <p className="sale-say" data-testid="sale-not-listed">Not for sale.</p>
      {owner === undefined && <p className="note">Reading the holder from NEAR first.</p>}
      {result}
    </>,
    "Not for sale",
  );
}

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const RECORD_HEAD: Record<RecordReport["verdict"], string> = { pass: "PASS", fail: "FAIL", pending: "Checking", unverified: "Not verified" };

/**
 * The enclave's signed record of a listed key: the holder's trades and the key's settled swaps, volume and tier. Asked for
 * without a wallet. Every check runs here in the browser before a fact is shown; an unknown op says the record is not out yet.
 */
function SignedRecord({ listing, owner, minter }: { listing: Listing; owner: string | null | undefined; minter: string | null | undefined }) {
  const [attempt, setAttempt] = useState(0);
  const key = `${listing.token_id}:${listing.seller}:${listing.price}:${attempt}`;
  /** The reply and the device time it arrived: the age is measured from that moment, not from each render. */
  const [got, setGot] = useState<{ key: string; res: RecordFetch; at: number } | null>(null);
  useEffect(() => {
    let live = true;
    void fetchKeyRecord(listing.token_id).then((res) => { if (live) setGot({ key, res, at: Date.now() }); });
    return () => { live = false; };
  }, [listing.token_id, key]);

  const cur = got && got.key === key ? got.res : null;
  const at = got && got.key === key ? got.at : 0;
  const report = useMemo<RecordReport | null>(() => (
    cur?.kind === "ok"
      ? verifyKeyRecord(cur.share, { tokenId: listing.token_id, chainOwner: owner, listedSeller: listing.seller, contractMinter: minter, nowMs: at })
      : null
  ), [cur, at, listing.token_id, listing.seller, owner, minter]);
  const st = report?.statement ?? null;

  return (
    <section className="sale-record" data-testid="sale-record" aria-labelledby="sale-record-h">
      <p className="eb">Signed record · enclave</p>
      <h3 id="sale-record-h">Signed record</h3>
      {cur === null && <p className="note" data-testid="sale-record-reading">Asking the enclave for the signed record.</p>}
      {cur?.kind === "unavailable" && <p className="sale-say" data-testid="sale-record-unavailable">The signed record opens with the next enclave release.</p>}
      {cur?.kind === "error" && (
        <>
          <p className="sale-say" data-testid="sale-record-error">The enclave did not return a signed record just now.</p>
          <div className="sale-actions"><Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)} testid="sale-record-retry">Try again</Button></div>
        </>
      )}
      {report && (
        <>
          <p className={`kp-verdict ${report.verdict}`} data-testid="sale-record-verdict" data-verdict={report.verdict}>{RECORD_HEAD[report.verdict]}</p>
          <p className="kp-say">Signed by the enclave; checked in your browser.</p>
          {st && (
            <dl className="kb-grid sale-facts" data-testid="sale-record-facts">
              <div><dt>Tier</dt><dd data-testid="sale-record-tier">{tierName(st.tier)}</dd></div>
              <div><dt>Settled swaps</dt><dd data-testid="sale-record-swaps">{st.settled_swaps}</dd></div>
              <div><dt>Volume</dt><dd data-testid="sale-record-volume">{formatUsdMicro(st.volume_usd_micro)}</dd></div>
              <div><dt>Holder&apos;s trades</dt><dd data-testid="sale-record-trades">{st.trades} · {formatUsdMicro(st.cost)} paid in</dd></div>
              <div><dt>Since</dt><dd>{st.since > 0 ? when(st.since) : "No trades yet"}</dd></div>
              <div><dt>PnL</dt><dd data-testid="sale-record-pnl">Not in this record: the signed statement does not value the holdings.</dd></div>
              <div><dt>Signed</dt><dd>{when(st.ts_ms)} · {ageLabel(st.ts_ms, at)}</dd></div>
            </dl>
          )}
          <ol className="kp-checks" data-testid="sale-record-checks">
            {report.checks.map((c) => (
              <li key={c.id} className="kp-check" data-testid={`sale-record-check-${c.id}`} data-pass={String(c.pass)}>
                <span className={`kp-mark ${c.pass === true ? "ok" : c.pass === false ? "bad" : "wait"}`} aria-hidden="true">{c.pass === true ? "✓" : c.pass === false ? "✕" : "…"}</span>
                <div>
                  <h3>{c.label}</h3>
                  <p>{c.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
