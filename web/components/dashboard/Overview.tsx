"use client";
import Link from "next/link";
import { Button, badgeFor } from "@/components/ui";
import { KeyArt } from "@/components/Art";
import { Guilloche, Hallmark } from "@/components/Engraving";
import { FoilCard } from "@/components/FoilCard";
import { TokenMark } from "@/components/TokenMark";
import { ErrorBox } from "@/components/Result";
import { TxResult } from "@/components/TxResult";
import { SignInOptions, type SignInOptionsProps } from "@/components/SignInModal";
import { Card, CardHeader, Icon, PageHeader, ProofPanel, SetupProgress, Skeleton, StatusChip, TierChip, VaultHero, type IconName, type SetupItem } from "@/components/v7";
import { useHealth } from "@/lib/useHealth";
import { assetByToken, formatUsdMicro, fromBaseUnits, type AssetRow, type Total } from "@/lib/amount";
import { chainName, fallbackTokens, useTokenList, type Token as ListToken } from "@/lib/tokens";
import { shortAccount, shortKeyId, tierName, type Token } from "@/lib/near";
import { keyCountText, kindLabel, meterPct, settledOrders, type HistEntry, type TierProgressRead } from "@/lib/dashboard";
import { KEYS_CONTRACT, WORKER_WASM_SHA256 } from "@/lib/config";
import { keyIdentity, serialOf } from "@/lib/traits";
import type { KeyStatus } from "@/lib/keyStore";

/**
 * The Overview body (/dashboard). Presentational: every value arrives as a prop from app/dashboard/view.tsx, which owns
 * the reads. A number is shown only when its read succeeded; every other state names what is missing.
 * Layout (mockup 20): the page title, the vault banner, then three columns: the key card, the middle (quick actions,
 * assets and activity, the proof) and the setup progress. Below: the tier progress and the three steps.
 * Order of states: signed out (sign-in options inline), signed in with keys still loading, signed in without a key (Mint),
 * signed in with a key (the full page).
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

/**
 * Earned-tier progress for the held key. `progress` comes only from the signed dashboard read; `levelled` only from a
 * level_up call that sent nft_set_tier. Nothing is shown as a number before that read.
 */
export type TierView = {
  /** The signed dashboard read succeeded for this session. */
  read: boolean;
  busy: boolean;
  busyLabel: string;
  progress: TierProgressRead | null;
  /** The read answered, but the key's record did not verify, so there is no progress to show. */
  unverifiable: boolean;
  error: ErrorInfo | null;
  onRead: () => void;
  levelBusy: boolean;
  levelLabel: string;
  levelError: ErrorInfo | null;
  /** The tier this call raised the key to, with the NEAR transaction. Null until a level up succeeds. */
  levelled: { tierBefore: number; tierAfter: number; txHash: string } | null;
  /** The level up ran and the record earns no higher tier yet. */
  noRaise: boolean;
  onLevelUp: () => void;
};

export type OverviewProps = {
  accountId: string | null;
  restoring: boolean;
  keys: KeysView;
  unlock: UnlockView;
  balance: BalanceView;
  activity: ActivityView;
  /** Earned-tier progress and the level up. Optional: the card is shown only for a held key with this view. */
  tier?: TierView;
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

/** Tone for a status word in the activity feed. The label stays the one from the shared badge table. */
const FEED_TONE: Record<string, "success" | "warn" | "error" | "info" | "neutral"> = {
  ok: "success", warn: "warn", bad: "error", info: "info", wait: "neutral",
};

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
  const rowCount = balance.rows?.length ?? 0;

  // The vault banner: the balance only from a signed read, otherwise "Sealed" and the one line that says why.
  let heroValue: string = "Sealed";
  let heroSub: string;
  if (!held) {
    heroSub = noKey ? "Your vault opens with your key. Mint one to start." : looking ? "Checking your key on NEAR mainnet…" : "The number of keys is not shown until NEAR mainnet answers.";
  } else if (!unlock.live) {
    heroSub = `Balances stay sealed until you sign a read. ${unlock.via === "privy" ? "Signed in-page. No popup." : "One signature. 30 minutes."}`;
  } else if (balance.read) {
    heroValue = totalText(balance.total) ?? "Sealed";
    heroSub = `${rowCount === 0 ? "No assets yet" : rowCount === 1 ? "1 asset" : `${rowCount} assets`}. Read with your session. No popup.`;
  } else if (balance.error) {
    heroValue = "Unavailable";
    heroSub = "The vault read did not complete. Try again from Assets below.";
  } else {
    heroSub = balance.busy ? balance.busyLabel : "Reading your vault…";
  }
  const heroActions = held ? (
    <>
      {!unlock.live && (
        <Button variant="banner" onClick={unlock.onUnlock} loading={unlock.busy} loadingLabel={unlock.busyLabel} testid="dash-unlock">
          Unlock
        </Button>
      )}
      <Button href="/vault" variant={unlock.live ? "banner" : "secondary"} className={unlock.live ? undefined : "v7-on-vault"} testid="dash-deposit">Deposit</Button>
      <Button href="/vault" variant="secondary" className="v7-on-vault" testid="dash-withdraw">Withdraw</Button>
    </>
  ) : undefined;

  return (
    <div className="page ov" data-testid="dash">
      <PageHeader
        eyebrow="Overview"
        title={<>Your <em>confidential</em> account</>}
        lead={p.accountId ? <>Signed in as <span className="v7-mono" data-testid="dash-account">{shortAccount(p.accountId, 6)}</span></> : undefined}
      />

      <VaultHero
        value={<span data-testid="stat-balance">{heroValue}</span>}
        sealed={heroValue === "Sealed"}
        sub={heroSub}
        actions={heroActions}
        testid="ov-vault"
      />
      {held && !unlock.live && unlock.error && <div className="ov-banner-err"><ErrorBox code={unlock.error} /></div>}

      <div className="ov-cols">
        {held && identity && keys.primary ? (
          <KeyCard
            token={keys.primary}
            identity={identity}
            tierKnown={tierKnown}
            caps={caps}
            count={keys.count}
            capped={keys.capped}
          />
        ) : noKey ? (
          <MintCard />
        ) : (
          <LookupCard failed={failed} onRetry={keys.onRetry} />
        )}

        <SetupChecklist held={held} looking={looking} unlock={unlock} unlocked={unlocked} funded={funded} swapped={swapped} balanceBusy={balance.busy} />

        <div className="ov-mid">
          {(held || noKey) && (
            <QuickActions held={held} />
          )}
          {held && (
            <div className="ov-pair">
              <AssetsCard unlock={unlock} balance={balance} unpriced={unpriced} />
              <ActivityCard unlock={unlock} activity={activity} settled={settled} recent={recent} />
            </div>
          )}
          <ProofCard callId={activity.callId} logOk={activity.logOk} />
        </div>
      </div>

      {held && p.tier && <TierCard tier={p.tier} unlock={unlock} />}

      <Steps step={noKey ? 2 : held ? 3 : 0} />
    </div>
  );
}

/** The key card: the key art, the finish, the serial, the name, the one sentence, the vault line and the caps. */
function KeyCard({ token, identity, tierKnown, caps, count, capped }: {
  token: Token;
  identity: ReturnType<typeof keyIdentity>;
  tierKnown: boolean;
  caps: { perTx: number; daily: number } | null;
  count: number;
  capped: boolean;
}) {
  const id = shortKeyId(token.token_id);
  return (
    <Card as="section" labelledBy="ov-key-h" testid="key-hero" className="ov-key">
      <div className="ov-key-top">
        <TierChip tier={tierKnown ? identity.finish : "Tier not readable"} testid="stat-tier" />
        <span className="v7-card-meta">1 of 1</span>
      </div>
      <figure className="ov-art">
        <FoilCard finish={identity.finish} className="ov-foil">
          <div className="top">
            <span className="tier">{tierKnown ? identity.finish : "—"}</span>
            <span className="oo">1 of 1</span>
          </div>
          <div className="art">
            <Guilloche seed={identity.seedHex} />
            <KeyArt n={identity.art} alt={`Artwork of key ${shortKeyId(token.token_id)}`} width={430} height={1080} priority />
          </div>
          <Hallmark bits={identity.bits} serial={serialOf(identity.seedHex)} />
        </FoilCard>
      </figure>
      <h2 id="ov-key-h" className="ov-key-name">{`KEYHOLE Key #${id}`}</h2>
      <p className="ov-sentence">Your NFT is the account: whoever holds the key controls the vault, and selling the key hands over the account. The keys to the money never leave the enclave.</p>
      <p className="ov-meta"><span data-testid="stat-keys">{keyCountText(count, capped)} {count === 1 && !capped ? "key" : "keys"} held</span>{count > 1 ? ". Showing the first." : ""}</p>
      <p className="ov-caps" data-testid="dash-caps">
        {caps ? `Caps: $${caps.perTx} a trade · $${caps.daily} a day` : "Caps: not readable for this tier right now"}
      </p>
    </Card>
  );
}

/** Signed in, no key: the sample artwork (labelled as one) and the one mint action. */
function MintCard() {
  return (
    <Card as="section" labelledBy="ov-mint-h" testid="mint-banner" className="ov-key">
      <div className="ov-key-top">
        <TierChip tier="Bronze" />
        <span className="v7-card-meta">Sample</span>
      </div>
      <figure className="ov-art">
        <FoilCard finish="Bronze" className="ov-foil">
          <div className="top">
            <span className="tier">Bronze</span>
            <span className="oo">Sample</span>
          </div>
          <div className="art">
            <KeyArt n={SAMPLE_BRONZE_ART} alt="Sample Bronze key artwork" width={430} height={1080} />
          </div>
        </FoilCard>
      </figure>
      <h2 id="ov-mint-h" className="ov-key-name">Mint your key</h2>
      <p className="ov-sentence">Your key is the account. Free. One signature. The enclave pays storage.</p>
      <p className="ov-caps">Only Bronze is mintable today: $1 a trade, $5 a day.</p>
      <div className="ov-key-action">
        <Button href="/mint" variant="primary" testid="dash-mint">Mint your key</Button>
      </div>
      <p className="ov-muted">The artwork is a sample. Your key&apos;s own art is chosen when it is minted.</p>
    </Card>
  );
}

/** Keys still loading, or the lookup failed: one card that says which, with a retry on failure. */
function LookupCard({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  return (
    <Card as="section" labelledBy="ov-loading-h" testid="dash-keys-state" className="ov-key ov-lookup">
      <h2 id="ov-loading-h" className="ov-key-name">{failed ? "Your keys did not load" : "Looking up your key"}</h2>
      {failed ? (
        <>
          <p className="ov-sentence">NEAR mainnet did not answer. The number of keys is not shown until it does.</p>
          <div className="ov-key-action"><Button variant="secondary" onClick={onRetry} testid="dash-keys-retry">Try again</Button></div>
        </>
      ) : (
        <Skeleton lines={4} testid="dash-keys-loading" />
      )}
    </Card>
  );
}

/** The four quick actions. Mint shows only when there is no key ("One key per account"); otherwise the activity page. */
function QuickActions({ held }: { held: boolean }) {
  const tiles: { id: string; label: string; href: string; icon: IconName; testid: string }[] = [
    { id: "swap", label: "Swap", href: "/swap", icon: "swap", testid: "dash-swap" },
    held
      ? { id: "activity", label: "Activity", href: "/settle", icon: "activity", testid: "ov-tile-activity" }
      : { id: "mint", label: "Mint key", href: "/mint", icon: "mint", testid: "ov-tile-mint" },
    { id: "vault", label: "Open vault", href: "/vault", icon: "vault", testid: "ov-tile-vault" },
    { id: "keys", label: "View keys", href: "/keys", icon: "key", testid: "ov-tile-keys" },
  ];
  return (
    <Card as="section" labelledBy="ov-quick-h" className="ov-quick">
      <CardHeader title="Quick actions" id="ov-quick-h" />
      <div className="ov-tiles">
        {tiles.map((t) => (
          <Link key={t.id} href={t.href} className="ov-tile" data-testid={t.testid}>
            <span className="ov-tile-icon" aria-hidden="true"><Icon name={t.icon} size={22} /></span>
            <span className="ov-tile-label">{t.label}</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

/** Assets: locked until the session is live; then the real rows from the signed balance read. */
function AssetsCard({ unlock, balance, unpriced }: { unlock: UnlockView; balance: BalanceView; unpriced: string[] }) {
  return (
    <Card as="section" labelledBy="dash-assets-h" testid="dash-assets" className="ov-half">
      <CardHeader
        title="Assets"
        id="dash-assets-h"
        icon="layers"
        meta={unlock.live && balance.read ? `${balance.rows?.length ?? 0} ${(balance.rows?.length ?? 0) === 1 ? "asset" : "assets"}` : undefined}
        action={
          unlock.live && balance.read ? (
            <button type="button" className="v7-card-link" onClick={balance.onRead} disabled={balance.busy} data-testid="dash-balance-refresh">
              {balance.busy ? balance.busyLabel : "Refresh"}
            </button>
          ) : (
            <Link href="/vault" className="v7-card-link" aria-label="Open your vault" data-testid="dash-open-vault">
              <Icon name="arrow-right" size={18} />
            </Link>
          )
        }
      />
      {!unlock.live ? (
        <UnlockLine unlock={unlock} label="Unlock to read your assets" />
      ) : !balance.read ? (
        balance.error ? (
          <div className="ov-stack">
            <ErrorBox code={balance.error.code} retryAfter={balance.error.retry_after} />
            <Button variant="secondary" size="sm" onClick={balance.onRead} testid="dash-balance-retry">Try again</Button>
          </div>
        ) : <p className="ov-muted">{balance.busy ? balance.busyLabel : "Reading your vault…"}</p>
      ) : null}
      {unlock.live && balance.read && balance.rows && balance.rows.length === 0 && <p className="ov-muted" data-testid="dash-assets-empty">No assets in this vault yet.</p>}
      {unlock.live && balance.rows && balance.rows.length > 0 && (
        <div className="ov-assets" data-testid="dash-asset-list">
          {balance.rows.map((row) => (
            <div className="v7-row ov-asset" key={row.key} data-token={row.symbol}>
              <span className="ov-asset-mark"><TokenMark assetId={row.known ? row.key : null} symbol={row.symbol} chain="near" size={24} /></span>
              <span className="v7-row-body">
                <span className="v7-row-title">{row.symbol}</span>
                {row.name ? <span className="v7-row-sub">{row.name}</span> : null}
              </span>
              <span className="v7-row-end">
                <span className="v7-row-value">{row.amountLabel}</span>
                {row.usdMicro != null ? <span className="v7-row-meta">{formatUsdMicro(row.usdMicro)}</span> : null}
              </span>
            </div>
          ))}
        </div>
      )}
      {unpriced.length > 0 && <p className="ov-muted" data-testid="dash-unpriced">Not priced: {unpriced.join(" · ")}</p>}
    </Card>
  );
}

/** The words a token gets in a row when we cannot name it. A raw token id is never printed. */
const OTHER_TOKEN = "another token";

/**
 * One row's words, from symbols only: "0.6 USDC → SOL" for a swap, "0.05 USDC to Base" for a withdrawal. The symbol comes from the
 * 1Click token list (or the vault's own two assets), so an id like "unknown.near" is never shown.
 */
export function rowPair(e: HistEntry, tokens: ListToken[]): string {
  const known = (id?: string) => {
    if (!id) return null;
    const t = tokens.find((x) => x.assetId.toLowerCase() === id.toLowerCase());
    if (t) return { symbol: t.symbol, decimals: t.decimals };
    const a = assetByToken(id);
    return a ? { symbol: a.symbol, decimals: a.decimals } : null;
  };
  const amount = (raw: string | number | null | undefined, k: { decimals: number } | null) =>
    raw != null && String(raw) !== "" && k ? fromBaseUnits(String(raw), k.decimals) : null;
  if (e.token_in) {
    const a = known(e.token_in);
    const b = known(e.token_out);
    const amt = amount(e.amount_in, a);
    return `${amt ? `${amt} ` : ""}${a?.symbol ?? OTHER_TOKEN} → ${b?.symbol ?? OTHER_TOKEN}`;
  }
  const k = known(e.token);
  const amt = amount(e.amount, k);
  const what = `${amt ? `${amt} ` : ""}${k?.symbol ?? OTHER_TOKEN}`;
  return e.kind === "withdraw" && e.chain ? `${what} to ${chainName(e.chain)}` : what;
}

/** Recent activity: the signed history, only when its attestation verifies. Locked until the session is live. */
function ActivityCard({ unlock, activity, settled, recent }: { unlock: UnlockView; activity: ActivityView; settled: number | null; recent: HistEntry[] }) {
  const list = useTokenList();
  const tokens = list.tokens.length > 0 ? list.tokens : fallbackTokens();
  return (
    <Card as="section" labelledBy="dash-activity-h" testid="dash-activity" className="ov-half">
      <div id="activity" className="ov-anchor" />
      <CardHeader
        title="Recent activity"
        id="dash-activity-h"
        icon="activity"
        meta={<span data-testid="stat-settled">Settled orders <b>{settled ?? "—"}</b></span>}
        action={
          <Link href="/settle" className="v7-card-link" aria-label="View all activity" data-testid="dash-view-activity">
            <Icon name="arrow-right" size={18} />
          </Link>
        }
      />
      {!unlock.live && !activity.read && <UnlockLine unlock={unlock} label="Unlock to read your activity" />}
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
          {recent.map((e, i) => {
            const badge = badgeFor(e.status);
            return (
              <li key={`${e.ts_ms ?? i}-${i}`} data-kind={e.kind ?? ""} className="v7-row ov-feed-row">
                <span className="v7-row-body">
                  <span className="v7-row-title">{kindLabel(e.kind)}</span>
                  <span className="v7-row-sub">{rowPair(e, tokens)}</span>
                  <span className="v7-row-sub">{e.ts_ms ? new Date(e.ts_ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Time not recorded"}</span>
                </span>
                {e.status ? <StatusChip tone={FEED_TONE[badge?.tone ?? ""] ?? "neutral"}>{badge?.label ?? e.status}</StatusChip> : null}
              </li>
            );
          })}
        </ol>
      )}
      {activity.read && activity.error && <ErrorBox code={activity.error.code} retryAfter={activity.error.retry_after} />}
      {activity.callId && (
        <p className="ov-meta ov-verify">
          <Link href={`/verify?call=${encodeURIComponent(activity.callId)}`} data-testid="dash-verify-read">Verify this read</Link>
          <span>{` · call ${activity.callId.slice(0, 8)}`}</span>
        </p>
      )}
    </Card>
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

/** One progress bar: the label and the real figures on the row above it. The fill is `done` of `needed`. */
function Meter({ label, done, needed, text, testid }: { label: string; done: number; needed: number; text: string; testid: string }) {
  const pct = meterPct(done, needed);
  return (
    <div className="ov-meter" data-testid={testid}>
      <div className="ov-meter-head"><span>{label}</span><b>{text}</b></div>
      <div className="ov-meter-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Earned tiers for the held key: the two targets for the next tier, from the signed dashboard read, and the level up that
 * sends the tier on chain once both are met. Locked: one line that starts the same unlock as the rest of the page.
 */
function TierCard({ tier, unlock }: { tier: TierView; unlock: UnlockView }) {
  const p = tier.progress;
  const next = p?.next ?? null;
  return (
    <Card as="section" labelledBy="ov-tier-h" testid="tier-progress" className="ov-tier">
      <CardHeader
        title="Tier progress"
        id="ov-tier-h"
        icon="tag"
        meta={p ? <>Earned tier <b>{tierName(p.current)}</b></> : undefined}
      />
      {!unlock.live ? (
        <UnlockLine unlock={unlock} label="Unlock to see progress" />
      ) : !tier.read && tier.error ? (
        <div className="ov-stack">
          <ErrorBox code={tier.error.code} retryAfter={tier.error.retry_after} />
          <Button variant="secondary" size="sm" onClick={tier.onRead} testid="tier-retry">Try again</Button>
        </div>
      ) : !tier.read ? (
        <p className="ov-muted">{tier.busy ? tier.busyLabel : "Reading your key’s record…"}</p>
      ) : tier.unverifiable || !p ? (
        <p className="ov-muted" data-testid="tier-unverifiable">The key’s record does not verify, so no progress is counted.</p>
      ) : next === null ? (
        <p className="ov-tier-say" data-testid="tier-top">{tierName(p.current)} is the top tier.</p>
      ) : (
        <div className="ov-tier-body">
          <p className="ov-tier-say">Next tier: <b data-testid="tier-next">{tierName(next)}</b>. Both targets must be met.</p>
          <Meter label="Settled swaps and copies" done={p.swaps} needed={p.swaps_needed} text={`${p.swaps} of ${p.swaps_needed}`} testid="tier-swaps" />
          <Meter label="Settled volume" done={p.volume_usd_micro} needed={p.volume_needed_usd_micro} text={`${formatUsdMicro(p.volume_usd_micro)} of ${formatUsdMicro(p.volume_needed_usd_micro)}`} testid="tier-volume" />
          {p.met && (
            <div className="ov-key-action">
              <Button variant="primary" onClick={tier.onLevelUp} loading={tier.levelBusy} loadingLabel={tier.levelLabel} testid="level-up">
                {`Level up to ${tierName(next)}`}
              </Button>
            </div>
          )}
        </div>
      )}
      {tier.levelError && <ErrorBox code={tier.levelError.code} retryAfter={tier.levelError.retry_after} />}
      {tier.noRaise && <p className="ov-muted" data-testid="level-none">No higher tier is earned yet.</p>}
      {tier.levelled && (
        <TxResult
          state="confirmed"
          hash={tier.levelled.txHash}
          title={`Tier raised: ${tierName(tier.levelled.tierBefore)} to ${tierName(tier.levelled.tierAfter)}`}
          testid="level-result"
        />
      )}
    </Card>
  );
}

/**
 * Setup, from real state only. Each open item has its one action; when every item is done the list is one line.
 * The shared SetupProgress draws it; this only computes the items.
 */
function SetupChecklist(p: {
  held: boolean; looking: boolean; unlock: UnlockView; unlocked: boolean; funded: boolean; swapped: boolean; balanceBusy: boolean;
}) {
  const { held, looking, unlock, unlocked, funded, swapped } = p;
  const items: SetupItem[] = [
    { id: "sign", title: "Sign in", done: true, note: "Signed in." },
    {
      id: "key", title: "Get your key", done: held,
      note: held ? "Held on NEAR mainnet." : looking ? "Checking NEAR mainnet…" : "Free. One signature.",
      action: !held && !looking ? <Button href="/mint" variant="secondary" size="sm" testid="setup-key-action">Mint a key</Button> : undefined,
    },
    {
      id: "unlock", title: "Unlock session", done: unlocked,
      note: unlock.live ? `${unlock.minutes} min left on this session.` : unlocked ? "Unlocked earlier on this visit." : held ? "One signature. 30 minutes." : "Needs a key first.",
      action: held && !unlocked ? (
        <Button variant="secondary" size="sm" onClick={unlock.onUnlock} loading={unlock.busy} loadingLabel={unlock.busyLabel} testid="setup-unlock-action">Unlock</Button>
      ) : undefined,
    },
    {
      id: "fund", title: "Fund the vault", done: funded,
      note: funded ? "Balance read from the vault." : !held ? "Needs a key first." : !unlocked ? "Checked once you unlock." : p.balanceBusy ? "Reading your vault…" : "A deposit is a transfer you approve in your wallet.",
      action: held && !funded ? <Button href="/vault" variant="secondary" size="sm" testid="setup-fund-action">Deposit</Button> : undefined,
    },
    {
      id: "swap", title: "First swap", done: swapped,
      note: swapped ? "Swap done. Read from your signed activity." : !held ? "Needs a key first." : !unlocked ? "Checked from your activity once you unlock." : "Swaps run inside the enclave, under your caps.",
      action: held && !swapped ? <Button href="/swap" variant="secondary" size="sm" testid="setup-swap-action">Swap</Button> : undefined,
    },
  ];
  return (
    <Card as="section" labelledBy="ov-setup-h" className="ov-setup">
      <SetupProgress items={items} variant="vertical" title="Setup progress" headingId="ov-setup-h" testid="setup-checklist" />
    </Card>
  );
}

/** Enclave status, the worker build, the contract and the way to check the last call. Every value is read, none is typed in. */
function ProofCard({ callId, logOk }: { callId: string | null; logOk: boolean | null }) {
  const online = useHealth();
  // The first entry is the published build; superseded builds follow it in the list (lib/config.ts).
  const build = WORKER_WASM_SHA256[0] ?? "";
  return (
    <ProofPanel
      headingId="ov-proof-h"
      enclave={online === null ? "checking" : online ? "live" : "down"}
      workerBuild={build || null}
      contract={KEYS_CONTRACT}
      attestation={logOk === true ? "verified" : logOk === false ? "not-verified" : "unread"}
      lastCall={callId}
      verifyHref={callId ? `/verify?call=${encodeURIComponent(callId)}` : "/verify"}
      verifyTestId="ov-verify"
      testid="ov-proof"
    />
  );
}

/** Three steps, one signature: the existing copy. The step that is next for this visitor is highlighted. */
function Steps({ step }: { step: number }) {
  const steps: { n: string; title: string; body: string; icon: IconName }[] = [
    { n: "01", title: "Connect", body: "Google or email (we create a NEAR account for you), any NEAR wallet, or MetaMask. Named or implicit account. No KYC.", icon: "unlock" },
    { n: "02", title: "Mint your key", body: "One gas-free signature (NEAR NEP-413 or MetaMask EIP-191). The TEE-held minter pays and mints the NFT to you.", icon: "key" },
    { n: "03", title: "Open the account", body: "Signed requests run inside Intel TDX. Caps are checked there, with an attestation for every call.", icon: "shield" },
  ];
  return (
    <section className="ov-steps" aria-labelledby="ov-steps-h">
      <h2 id="ov-steps-h" className="ov-steps-h">Three steps. One signature.</h2>
      <div className="ov-steps-grid">
        {steps.map((s, i) => (
          <article key={s.n} className={`v7-card ov-explain${step === i + 1 ? " is-next" : ""}`} aria-current={step === i + 1 ? "step" : undefined}>
            <div className="ov-explain-top">
              <span className="v7-mono ov-explain-n">{s.n}</span>
              <span className="ov-explain-icon" aria-hidden="true"><Icon name={s.icon} size={22} /></span>
            </div>
            <h3 className="ov-explain-h">{s.title}</h3>
            <p className="ov-explain-body">{s.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Restoring() {
  return (
    <div className="page ov" data-testid="dash">
      <PageHeader eyebrow="Overview" title="Overview" />
      <Skeleton lines={3} testid="dash-restoring" />
    </div>
  );
}

/** Signed out: the sign-in options inline and the sample key beside them, then the three steps. */
function SignedOut({ signIn }: { signIn: SignInOptionsProps }) {
  return (
    <div className="page ov ov-out" data-testid="dash">
      <PageHeader
        eyebrow="Overview"
        title={<>Open your <em>key</em></>}
        lead="Your key is an NFT on NEAR mainnet, and the account behind it. Sign in to see the keys you hold. Your vault and activity open only when you unlock."
      />
      <div className="ov-signed-out">
        <Card as="section" labelledBy="ov-signin-h" testid="dash-connect" className="ov-signin">
          <h2 id="ov-signin-h" className="v7-card-h">Sign in</h2>
          <SignInOptions {...signIn} />
          <Link className="ov-link" href="/judge" data-testid="dash-explore">Explore without a wallet</Link>
        </Card>
        <Card as="section" labelledBy="ov-sample-h" className="ov-key ov-sample">
          <div className="ov-key-top">
            <TierChip tier="Bronze" />
            <span className="v7-card-meta">Sample</span>
          </div>
          <figure className="ov-art">
            <FoilCard finish="Bronze" className="ov-foil">
              <div className="top">
                <span className="tier">Bronze</span>
                <span className="oo">Sample</span>
              </div>
              <div className="art">
                <KeyArt n={SAMPLE_BRONZE_ART} alt="Sample Bronze key artwork" width={430} height={1080} />
              </div>
            </FoilCard>
          </figure>
          <h2 id="ov-sample-h" className="ov-key-name">KEYHOLE Key</h2>
          <p className="ov-sentence">Minting today issues a Bronze key: $1 a trade, $5 a day. Silver and Gold are previews for now.</p>
        </Card>
      </div>
      <Steps step={1} />
    </div>
  );
}
