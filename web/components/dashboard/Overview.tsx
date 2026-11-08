"use client";
import Link from "next/link";
import { Badge, Button, Card, Skeleton } from "@/components/ui";
import { KeyArt } from "@/components/Art";
import { TokenIcon } from "@/components/TokenIcon";
import { ErrorBox } from "@/components/Result";
import { TxLink } from "@/components/TxLink";
import { SignInOptions, type SignInOptionsProps } from "@/components/SignInModal";
import { useHealth } from "@/lib/useHealth";
import { formatUsdMicro, type AssetRow, type Total } from "@/lib/amount";
import { shortAccount, shortKeyId, type Token } from "@/lib/near";
import { capsOf, entryDetail, keyCountText, kindLabel, settledOrders, type HistEntry } from "@/lib/dashboard";
import { KEYS_CONTRACT, WORKER_WASM_SHA256 } from "@/lib/config";
import { keyIdentity } from "@/lib/traits";
import type { KeyStatus } from "@/lib/keyStore";

/**
 * The Overview body (/dashboard). Presentational: every value arrives as a prop from app/dashboard/view.tsx, which owns
 * the reads. A number is shown only when its read succeeded; every other state names what is missing.
 * Order of states: signed out (sign-in options inline), signed in without a key (Mint), signed in with a key (the key
 * card, the setup checklist, the proof, then the signed assets and activity).
 */

export type KeysView = {
  status: KeyStatus;
  count: number;
  capped: boolean;
  /** The first key. The key card is drawn from it. */
  primary: Token | null;
  /** nft_tier of the first key, or null when unreadable. */
  tier: number | null;
  onRetry: () => void;
};

export type UnlockView = {
  /** The 30-minute session is live for the first key. */
  live: boolean;
  minutes: number;
  busy: boolean;
  busyLabel: string;
  via: "nc" | "ws" | "privy" | null;
  error: string | null;
  /** The one unlock: startSession for the first key (one signature, or in-page for Google and email). */
  onUnlock: () => void;
};

export type ErrorInfo = { code: string; retry_after?: number };

export type BalanceView = {
  /** The signed balance read has succeeded for this account. */
  read: boolean;
  busy: boolean;
  busyLabel: string;
  total: Total | null;
  rows: AssetRow[] | null;
  error: ErrorInfo | null;
  onRead: () => void;
};

export type ActivityView = {
  read: boolean;
  busy: boolean;
  busyLabel: string;
  entries: HistEntry[] | null;
  /** null while the attestation is checked; false when it does not verify (entries are then hidden). */
  logOk: boolean | null;
  callId: string | null;
  error: ErrorInfo | null;
  onRead: () => void;
};

export type OverviewProps = {
  accountId: string | null;
  restoring: boolean;
  keys: KeysView;
  unlock: UnlockView;
  balance: BalanceView;
  activity: ActivityView;
  /** The sign-in handlers for the signed-out card (the same rows as the sign-in sheet). */
  signIn: SignInOptionsProps;
};

const RECENT = 8;
/** The mintable tier's artwork, shown as a sample on the Mint card. Token ids pick the art only once a key is minted. */
const SAMPLE_BRONZE_ART = 3;

function totalText(total: Total | null): string | undefined {
  if (!total || total.kind === "unread") return undefined;
  if (total.kind === "empty") return formatUsdMicro(0);
  if (total.kind === "amounts") return total.text;
  return formatUsdMicro(total.micro);
}

export function Overview(p: OverviewProps) {
  if (!p.accountId) {
    return p.restoring ? <Restoring /> : <SignedOut signIn={p.signIn} />;
  }
  const { keys, unlock, balance, activity } = p;
  const ready = keys.status === "ready";
  const looking = keys.status === "idle" || keys.status === "loading";
  const failed = keys.status === "error";
  const held = ready && keys.count > 0 && !!keys.primary;
  const noKey = ready && keys.count === 0;
  const identity = held && keys.primary ? keyIdentity(keys.primary.token_id, keys.tier) : null;
  // The tier is shown and capped only when nft_tier answered; an unreadable tier never prints a finish or caps.
  const tierKnown = keys.tier === 1 || keys.tier === 2 || keys.tier === 3;
  const caps = identity && tierKnown ? { perTx: identity.perTx, daily: identity.daily } : null;
  const funded = balance.read && !!balance.total && (
    balance.total.kind === "amounts" ||
    ((balance.total.kind === "usd" || balance.total.kind === "partial") && balance.total.micro > 0)
  );
  const settled = activity.read && activity.logOk === true && activity.entries ? settledOrders(activity.entries) : null;
  const swapped = settled != null && settled > 0;
  const unlocked = unlock.live || balance.read || activity.read;
  const recent = activity.entries ? [...activity.entries].reverse().slice(0, RECENT) : [];
  const unpriced = balance.total?.kind === "partial" ? balance.total.unpriced : [];

  return (
    <div className="page ov" data-testid="dash">
      <header className="ov-head">
        <h1 className="ov-title">Overview</h1>
        <p className="ov-meta">Signed in as <span className="ov-mono" data-testid="dash-account">{shortAccount(p.accountId, 6)}</span></p>
      </header>

      {held && identity && keys.primary ? (
        <section className="ov-hero kh-card" aria-labelledby="ov-hero-h" data-testid="key-hero">
          <figure className="ov-art">
            <KeyArt n={identity.art} alt={`Artwork of key ${shortKeyId(keys.primary.token_id)}`} width={430} height={1080} priority />
          </figure>
          <div className="ov-hero-body">
            <p className="ov-eb">Your key</p>
            <h2 id="ov-hero-h" className="ov-name">
              {`Key #${shortKeyId(keys.primary.token_id)} · `}<span data-testid="stat-tier">{tierKnown ? identity.finish : "Tier not readable"}</span>
            </h2>
            <p className="ov-sentence">Your NFT is the account: whoever holds the key controls the vault, and selling the key hands over the account. The keys to the money never leave the enclave.</p>
            <p className="ov-meta"><span data-testid="stat-keys">{keyCountText(keys.count, keys.capped)} {keys.count === 1 && !keys.capped ? "key" : "keys"} held</span>{keys.count > 1 ? ". Showing the first." : ""}</p>

            <div className="ov-vault">
              <span className="ov-label">Vault</span>
              {unlock.live ? (
                balance.read ? (
                  <span className="ov-amount" data-testid="stat-balance">{totalText(balance.total)}</span>
                ) : balance.error ? (
                  <span className="ov-amount ov-muted" data-testid="stat-balance">Unavailable</span>
                ) : (
                  <span className="ov-amount ov-muted" data-testid="stat-balance">{balance.busy ? balance.busyLabel : "Reading…"}</span>
                )
              ) : (
                <span className="ov-amount ov-locked" data-testid="stat-balance">Locked</span>
              )}
              {!unlock.live && (
                <div className="ov-unlock">
                  <Button variant="primary" size="md" onClick={unlock.onUnlock} loading={unlock.busy} loadingLabel={unlock.busyLabel} testid="dash-unlock">
                    Unlock
                  </Button>
                  <span className="ov-muted">{unlock.via === "privy" ? "Signed in-page. No popup." : "One signature. 30 minutes."}</span>
                  {unlock.error && <ErrorBox code={unlock.error} />}
                </div>
              )}
              {unlock.live && balance.error && (
                <div className="ov-unlock">
                  <ErrorBox code={balance.error.code} retryAfter={balance.error.retry_after} />
                  <Button variant="secondary" size="sm" onClick={balance.onRead} testid="dash-balance-retry">Try again</Button>
                </div>
              )}
              {unlock.live && <span className="ov-muted">Read with your session. No popup.</span>}
            </div>

            <p className="ov-caps" data-testid="dash-caps">
              {caps ? `Caps: $${caps.perTx} a trade · $${caps.daily} a day` : "Caps: not readable for this tier right now"}
            </p>

            <div className="ov-actions">
              <Button href="/swap" variant={unlock.live ? "primary" : "secondary"} testid="dash-swap">Swap</Button>
              <Button href="/vault" variant="secondary" testid="dash-deposit">Deposit</Button>
              <Button href="/vault" variant="secondary" testid="dash-withdraw">Withdraw</Button>
            </div>
          </div>
        </section>
      ) : noKey ? (
        <section className="ov-hero kh-card" aria-labelledby="ov-mint-h" data-testid="mint-banner">
          <figure className="ov-art">
            <KeyArt n={SAMPLE_BRONZE_ART} alt="Sample Bronze key artwork" width={430} height={1080} />
          </figure>
          <div className="ov-hero-body">
            <p className="ov-eb">No key yet</p>
            <h2 id="ov-mint-h" className="ov-name">Mint your key</h2>
            <p className="ov-sentence">Your key is the account. Free. One signature. The enclave pays storage.</p>
            <p className="ov-caps">Only Bronze is mintable today: $1 a trade, $5 a day.</p>
            <div className="ov-actions">
              <Button href="/mint" variant="primary" size="lg" testid="dash-mint">Mint your key</Button>
            </div>
            <p className="ov-muted">The artwork is a sample. Your key&apos;s own art is chosen when it is minted.</p>
          </div>
        </section>
      ) : (
        <section className="ov-hero kh-card" aria-labelledby="ov-loading-h" data-testid="dash-keys-state">
          <div className="ov-hero-body ov-hero-wide">
            <h2 id="ov-loading-h" className="ov-name">{failed ? "Your keys did not load" : "Looking up your key"}</h2>
            {failed ? (
              <>
                <p className="ov-sentence">NEAR mainnet did not answer. The number of keys is not shown until it does.</p>
                <div className="ov-actions"><Button variant="secondary" onClick={keys.onRetry} testid="dash-keys-retry">Try again</Button></div>
              </>
            ) : (
              <Skeleton lines={3} testid="dash-keys-loading" />
            )}
          </div>
        </section>
      )}

      <div className="ov-grid">
        <SetupChecklist held={held} looking={looking} unlock={unlock} unlocked={unlocked} funded={funded} swapped={swapped} balanceBusy={balance.busy} />
        <ProofCard callId={activity.callId} />
      </div>

      {held && (
        <div className="ov-grid">
          <section className="ov-card kh-card" aria-labelledby="dash-assets-h" data-testid="dash-assets">
            <div className="ov-card-head">
              <h2 id="dash-assets-h">Assets</h2>
              {unlock.live && balance.read && (
                <button type="button" className="ov-text-btn" onClick={balance.onRead} disabled={balance.busy} data-testid="dash-balance-refresh">
                  {balance.busy ? balance.busyLabel : "Refresh"}
                </button>
              )}
            </div>
            {!unlock.live ? (
              <UnlockLine unlock={unlock} label="Unlock to read" />
            ) : !balance.read ? (
              balance.error ? <ErrorBox code={balance.error.code} retryAfter={balance.error.retry_after} /> : <p className="ov-muted">{balance.busy ? balance.busyLabel : "Reading your vault…"}</p>
            ) : null}
            {unlock.live && balance.read && balance.rows && balance.rows.length === 0 && <p className="ov-muted" data-testid="dash-assets-empty">No assets in this vault yet.</p>}
            {unlock.live && balance.rows && balance.rows.length > 0 && (
              <div className="ov-assets" data-testid="dash-asset-list">
                {balance.rows.map((row) => (
                  <div className="ov-row" key={row.key} data-token={row.symbol}>
                    <TokenIcon assetId={row.known ? row.key : null} symbol={row.symbol} size={24} />
                    <div className="ov-row-who"><b>{row.symbol}</b>{row.name ? <small>{row.name}</small> : null}</div>
                    <div className="ov-row-amt"><b>{row.amountLabel}</b>{row.usdMicro != null ? <small>{formatUsdMicro(row.usdMicro)}</small> : null}</div>
                  </div>
                ))}
              </div>
            )}
            {unpriced.length > 0 && <p className="ov-muted" data-testid="dash-unpriced">Not priced: {unpriced.join(" · ")}</p>}
            <div className="ov-actions">
              <Button href="/vault" variant="secondary" size="sm" testid="dash-open-vault">Open your vault</Button>
            </div>
          </section>

          <section className="ov-card kh-card" id="activity" aria-labelledby="dash-activity-h" data-testid="dash-activity">
            <div className="ov-card-head">
              <h2 id="dash-activity-h">Recent activity</h2>
              <span className="ov-fact" data-testid="stat-settled">
                Settled orders <b>{settled ?? "—"}</b>
              </span>
            </div>
            {!unlock.live && !activity.read && <UnlockLine unlock={unlock} label="Unlock to read" />}
            {unlock.live && !activity.read && (
              activity.error
                ? <ErrorBox code={activity.error.code} retryAfter={activity.error.retry_after} />
                : <p className="ov-muted">{activity.busy ? activity.busyLabel : "Reading this key’s log…"}</p>
            )}
            {activity.read && activity.logOk === null && <p className="ov-muted">Checking the log…</p>}
            {activity.read && activity.logOk === false && <p className="ov-muted" data-testid="dash-log-hidden">The log did not verify, so no entries are shown and none are counted.</p>}
            {activity.read && activity.logOk === true && recent.length === 0 && <p className="ov-muted" data-testid="dash-empty">No trades on this key yet.</p>}
            {activity.logOk === true && recent.length > 0 && (
              <ol className="ov-feed" data-testid="dash-feed">
                {recent.map((e, i) => (
                  <li key={`${e.ts_ms ?? i}-${i}`} data-kind={e.kind ?? ""}>
                    <span className="ov-feed-k">{kindLabel(e.kind)}</span>
                    {e.status ? <Badge status={e.status} /> : <span />}
                    <span className="ov-feed-d">{entryDetail(e)}</span>
                    <span className="ov-feed-t">{e.ts_ms ? new Date(e.ts_ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Time not recorded"}</span>
                  </li>
                ))}
              </ol>
            )}
            {activity.read && activity.error && <ErrorBox code={activity.error.code} retryAfter={activity.error.retry_after} />}
            {activity.callId && (
              <p className="ov-meta">
                <Link href={`/verify?call=${encodeURIComponent(activity.callId)}`} data-testid="dash-verify-read">Verify this read</Link>
                <span>{` · call ${activity.callId.slice(0, 8)}`}</span>
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/** The one muted line that starts the same unlock as the pill. No per-card sign buttons. */
function UnlockLine({ unlock, label }: { unlock: UnlockView; label: string }) {
  return (
    <p className="ov-unlock-line">
      <button type="button" className="ov-text-btn" onClick={unlock.onUnlock} disabled={unlock.busy} data-testid="dash-unlock-line">
        {unlock.busy ? unlock.busyLabel : label}
      </button>
      {unlock.via === "privy" && !unlock.busy && <span className="ov-muted"> Signed in-page. No popup.</span>}
    </p>
  );
}

type Row = {
  id: string;
  title: string;
  done: boolean;
  note: string;
  action?: { label: string; href?: string; onClick?: () => void; loading?: boolean; loadingLabel?: string };
};

/** Setup, from real state only. Each open row has its one action; when every row is done the list collapses. */
function SetupChecklist(p: {
  held: boolean; looking: boolean; unlock: UnlockView; unlocked: boolean; funded: boolean; swapped: boolean; balanceBusy: boolean;
}) {
  const { held, looking, unlock, unlocked, funded, swapped } = p;
  const rows: Row[] = [
    { id: "sign", title: "Sign in", done: true, note: "Signed in." },
    {
      id: "key", title: "Get your key", done: held,
      note: held ? "Held on NEAR mainnet." : looking ? "Checking NEAR mainnet…" : "Free. One signature.",
      action: !held && !looking ? { label: "Mint a key", href: "/mint" } : undefined,
    },
    {
      id: "unlock", title: "Unlock", done: unlocked,
      note: unlock.live ? `${unlock.minutes} min left on this session.` : unlocked ? "Unlocked earlier on this visit." : held ? "One signature. 30 minutes." : "Needs a key first.",
      action: held && !unlocked ? { label: "Unlock", onClick: unlock.onUnlock, loading: unlock.busy, loadingLabel: unlock.busyLabel } : undefined,
    },
    {
      id: "fund", title: "Fund the vault", done: funded,
      note: funded ? "Balance read from the vault." : !held ? "Needs a key first." : !unlocked ? "Checked once you unlock." : p.balanceBusy ? "Reading your vault…" : "A deposit is a transfer you approve in your wallet.",
      action: held && !funded ? { label: "Deposit", href: "/vault" } : undefined,
    },
    {
      id: "swap", title: "First swap", done: swapped,
      note: swapped ? "Read from your signed activity." : !held ? "Needs a key first." : !unlocked ? "Checked from your activity once you unlock." : "Swaps run inside the enclave, under your caps.",
      action: held && !swapped ? { label: "Swap", href: "/swap" } : undefined,
    },
  ];
  const complete = rows.every((r) => r.done);

  return (
    <section className="ov-card kh-card" aria-labelledby="ov-setup-h" data-testid="setup-checklist">
      <div className="ov-card-head">
        <h2 id="ov-setup-h">Setup</h2>
        <span className="ov-muted">{rows.filter((r) => r.done).length} of {rows.length}</span>
      </div>
      {complete ? (
        <p className="ov-complete" data-testid="setup-complete"><span className="ov-tick" aria-hidden="true">✓</span> Setup complete</p>
      ) : (
        <ol className="ov-steps">
          {rows.map((r, i) => (
            <li key={r.id} className={`ov-step${r.done ? " done" : ""}`} data-testid={`setup-${r.id}`} data-done={r.done ? "1" : "0"}>
              <span className="ov-num" aria-hidden="true">{r.done ? "✓" : i + 1}</span>
              <div className="ov-step-body">
                <b>{r.title}</b>
                <small>{r.note}</small>
              </div>
              {r.action && (
                r.action.href ? (
                  <Button href={r.action.href} variant="secondary" size="sm" testid={`setup-${r.id}-action`}>{r.action.label}</Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={r.action.onClick} loading={r.action.loading} loadingLabel={r.action.loadingLabel} testid={`setup-${r.id}-action`}>{r.action.label}</Button>
                )
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Enclave status, the worker build, the contract and the way to check the last call. Every value is read, none is typed in. */
function ProofCard({ callId }: { callId: string | null }) {
  const online = useHealth();
  // The first entry is the published build; superseded builds follow it in the list (lib/config.ts).
  const build = WORKER_WASM_SHA256[0] ?? "";
  return (
    <section className="ov-card kh-card" aria-labelledby="ov-proof-h" data-testid="ov-proof">
      <div className="ov-card-head">
        <h2 id="ov-proof-h">Proof</h2>
      </div>
      <dl className="ov-kv">
        <div>
          <dt>Enclave</dt>
          <dd data-testid="ov-enclave" data-state={online === null ? "checking" : online ? "live" : "down"}>
            {online === null ? "Checking…" : online ? "Live" : "Not reachable right now"}
          </dd>
        </div>
        <div><dt>Hardware</dt><dd>Intel TDX</dd></div>
        <div><dt>Worker build</dt><dd className="ov-mono" title={build}>{build ? `${build.slice(0, 12)}…` : "—"}</dd></div>
        <div><dt>Contract</dt><dd><TxLink account={KEYS_CONTRACT} /></dd></div>
      </dl>
      <div className="ov-actions">
        <Button href={callId ? `/verify?call=${encodeURIComponent(callId)}` : "/verify"} variant="secondary" size="sm" testid="ov-verify">Verify the last call</Button>
      </div>
    </section>
  );
}

function Restoring() {
  return (
    <div className="page ov" data-testid="dash">
      <header className="ov-head"><h1 className="ov-title">Overview</h1></header>
      <Skeleton lines={3} testid="dash-restoring" />
    </div>
  );
}

/** Signed out: one centred card with the sign-in options inline, and a way to explore without a wallet. */
function SignedOut({ signIn }: { signIn: SignInOptionsProps }) {
  return (
    <div className="page ov ov-out" data-testid="dash">
      <section className="ov-signin kh-card" aria-labelledby="ov-signin-h" data-testid="dash-connect">
        <h1 id="ov-signin-h" className="ov-title">Open your key</h1>
        <p className="ov-lead">Your key is an NFT on NEAR mainnet, and the account behind it. Sign in to see the keys you hold. Your vault and activity open only when you unlock.</p>
        <SignInOptions {...signIn} />
        <Link className="ov-link" href="/judge" data-testid="dash-explore">Explore without a wallet</Link>
      </section>
    </div>
  );
}
