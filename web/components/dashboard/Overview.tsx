"use client";
import Link from "next/link";
import { Badge, Button, Card, Skeleton, StatCard } from "@/components/ui";
import { TokenIcon } from "@/components/TokenIcon";
import { ErrorBox } from "@/components/Result";
import { formatUsdMicro, type AssetRow, type Total } from "@/lib/amount";
import { shortAccount, tierName } from "@/lib/near";
import { capsOf, entryDetail, keyCountText, kindLabel, settledOrders, type HistEntry } from "@/lib/dashboard";

/**
 * The Overview body (/dashboard). Presentational: every value arrives as a prop from app/dashboard/view.tsx, which owns
 * the reads. A number is shown only when its read succeeded; every other state names what is missing.
 */

export type KeysView = {
  status: "idle" | "loading" | "ready" | "error";
  count: number;
  capped: boolean;
  tier: number | null;
  onRetry: () => void;
};

export type ErrorInfo = { code: string; retry_after?: number };

export type BalanceView = {
  /** The signed balance read has succeeded for this account. */
  read: boolean;
  busy: boolean;
  busyLabel: string;
  sessionLive: boolean;
  total: Total | null;
  rows: AssetRow[] | null;
  error: ErrorInfo | null;
  onSign: () => void;
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
  balance: BalanceView;
  activity: ActivityView;
};

const RECENT = 8;

function totalText(total: Total | null): string | undefined {
  if (!total || total.kind === "unread") return undefined;
  if (total.kind === "empty") return formatUsdMicro(0);
  if (total.kind === "amounts") return total.text;
  return formatUsdMicro(total.micro);
}

export function Overview(p: OverviewProps) {
  if (!p.accountId) {
    return p.restoring ? <Restoring /> : <ConnectHero />;
  }
  const { keys, balance, activity } = p;
  const ready = keys.status === "ready";
  const held = ready && keys.count > 0;
  const noKey = ready && keys.count === 0;
  const looking = keys.status === "idle" || keys.status === "loading";
  const failed = keys.status === "error";
  const caps = held ? capsOf(keys.tier) : null;
  const tier = held && keys.tier != null ? tierName(keys.tier) : "—";
  const tierShown = tier !== "—" ? tier : undefined;
  const unpriced = balance.total?.kind === "partial" ? balance.total.unpriced : [];
  const recent = activity.entries ? [...activity.entries].reverse().slice(0, RECENT) : [];

  return (
    <div className="page dash" data-testid="dash">
      <header className="dash-head">
        <h1>Hello, <span className="dash-id" data-testid="dash-account">{shortAccount(p.accountId, 6)}</span></h1>
        <p className="dash-lead">Every figure here is read from NEAR mainnet or the enclave. Nothing is estimated.</p>
      </header>

      <div className="dash-stats">
        <StatCard
          testid="stat-keys"
          label="My keys"
          value={ready ? keyCountText(keys.count, keys.capped) : undefined}
          empty={looking ? "Looking up your keys…" : failed ? <Button variant="secondary" size="sm" onClick={keys.onRetry} testid="dash-keys-retry">Try again</Button> : undefined}
          hint={failed ? "NEAR mainnet did not answer." : "Held on NEAR mainnet"}
        />
        <StatCard
          testid="stat-tier"
          label="Tier and caps"
          value={tierShown}
          empty={held ? "Tier not readable right now" : looking ? "Looking up…" : failed ? "Unavailable" : "No key yet"}
          hint={caps ? `$${caps.perTx} a trade · $${caps.daily} a day` : held ? undefined : "Caps apply once you hold a key"}
        />
        <StatCard
          testid="stat-balance"
          label="Vault balance"
          value={balance.read ? totalText(balance.total) : undefined}
          empty={
            !held
              ? (noKey ? "Mint a key to open a vault" : looking ? "Looking up your key…" : "Needs a key")
              : balance.busy
                ? balance.busyLabel
                : <Button variant="primary" size="sm" onClick={balance.onSign} loading={balance.busy} loadingLabel={balance.busyLabel} testid="dash-unseal">
                    {balance.sessionLive ? "Unseal (session, no popup)" : "Sign to unseal"}
                  </Button>
          }
          hint={balance.read ? (balance.sessionLive ? "Read with your session" : "Read with your signature") : held ? "Sealed until you sign" : undefined}
        />
        {held && (
          <StatCard
            testid="stat-settled"
            label="Settled orders"
            value={activity.read && activity.logOk === true && activity.entries ? String(settledOrders(activity.entries)) : undefined}
            empty={
              !activity.read ? <Link href="#activity">Read activity to count them</Link>
                : activity.logOk === null ? "Checking the log…"
                : activity.logOk === false ? "Not counted: the log did not verify."
                : undefined
            }
            hint="Successful swaps and copy trades on this key"
          />
        )}
      </div>

      {noKey && (
        <Card as="section" tone="banner" size="lg" className="dash-banner" aria-labelledby="dash-mint-h" testid="mint-banner">
          <h2 id="dash-mint-h">Mint your key</h2>
          <p>Your key is the account. Minting is free, the enclave pays, and only Bronze is mintable today.</p>
          <div className="dash-actions">
            <Button variant="banner" href="/mint" testid="dash-mint">Mint a key</Button>
          </div>
        </Card>
      )}

      {held && (
        <div className="dash-two">
          <Card as="section" size="lg" className="dash-card" aria-labelledby="dash-assets-h" testid="dash-assets">
            <div className="dash-card-head">
              <h2 id="dash-assets-h">Vault assets</h2>
              {balance.read && (
                <Button variant="secondary" size="sm" onClick={balance.onSign} loading={balance.busy} loadingLabel={balance.busyLabel} testid="dash-balance-refresh">
                  {balance.busy ? balance.busyLabel : "Refresh"}
                </Button>
              )}
            </div>
            {!balance.read && <p>{balance.busy ? balance.busyLabel : "Assets appear here after you sign. Only your signature can open the vault."}</p>}
            {balance.read && balance.rows && balance.rows.length === 0 && <p data-testid="dash-assets-empty">No assets in this vault yet.</p>}
            {balance.rows && balance.rows.length > 0 && (
              <div className="dash-assets" data-testid="dash-asset-list">
                {balance.rows.map((row) => (
                  <div className="dash-row" key={row.key} data-token={row.symbol}>
                    <TokenIcon assetId={row.known ? row.key : null} symbol={row.symbol} size="md" />
                    <div className="who"><b>{row.symbol}</b>{row.name ? <small>{row.name}</small> : null}</div>
                    <div className="amt"><b>{row.amountLabel}</b>{row.usdMicro != null ? <small>{formatUsdMicro(row.usdMicro)}</small> : null}</div>
                  </div>
                ))}
              </div>
            )}
            {unpriced.length > 0 && <p className="dash-note" data-testid="dash-unpriced">Not priced: {unpriced.join(" · ")}</p>}
            {balance.error && <ErrorBox code={balance.error.code} retryAfter={balance.error.retry_after} />}
            <div className="dash-actions">
              <Button href="/vault" testid="dash-open-vault">Open your vault</Button>
            </div>
          </Card>

          <Card as="section" size="lg" className="dash-card" id="activity" aria-labelledby="dash-activity-h" testid="dash-activity">
            <div className="dash-card-head">
              <h2 id="dash-activity-h">Recent activity</h2>
              <Button variant="secondary" size="sm" onClick={activity.onRead} loading={activity.busy} loadingLabel={activity.busyLabel} testid="dash-activity-read">
                {activity.busy ? activity.busyLabel : activity.read ? "Refresh" : "Sign to read"}
              </Button>
            </div>
            {!activity.read && !activity.busy && <p>Sign to read this key&apos;s log. Each entry is checked against the enclave&apos;s published build before it is listed.</p>}
            {activity.read && activity.logOk === null && <p>Checking the log…</p>}
            {activity.read && activity.logOk === false && <p data-testid="dash-log-hidden">The log did not verify, so no entries are shown.</p>}
            {activity.read && activity.logOk === true && recent.length === 0 && <p data-testid="dash-empty">No trades on this key yet.</p>}
            {activity.logOk === true && recent.length > 0 && (
              <ol className="dash-feed" data-testid="dash-feed">
                {recent.map((e, i) => (
                  <li key={`${e.ts_ms ?? i}-${i}`} data-kind={e.kind ?? ""}>
                    <span className="k">{kindLabel(e.kind)}</span>
                    {e.status ? <Badge status={e.status} /> : <span />}
                    <span className="d">{entryDetail(e)}</span>
                    <span className="t">{e.ts_ms ? new Date(e.ts_ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Time not recorded"}</span>
                  </li>
                ))}
              </ol>
            )}
            {activity.error && <ErrorBox code={activity.error.code} retryAfter={activity.error.retry_after} />}
            {activity.callId && (
              <p className="dash-meta">
                <Link href={`/verify?call=${encodeURIComponent(activity.callId)}`} data-testid="dash-verify-read">Verify this read</Link>
                <span>call {activity.callId.slice(0, 8)}</span>
              </p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function Restoring() {
  return (
    <div className="page dash" data-testid="dash">
      <header className="dash-head"><h1>Overview</h1></header>
      <Skeleton lines={3} testid="dash-restoring" />
    </div>
  );
}

function ConnectHero() {
  return (
    <div className="page dash" data-testid="dash">
      <header className="dash-head"><h1>Overview</h1></header>
      <Card as="section" size="lg" className="dash-hero" aria-labelledby="dash-hero-h" testid="dash-connect">
        <h2 id="dash-hero-h">Connect to see your keys</h2>
        <p className="dash-lead">Your key is an NFT on NEAR mainnet, and the account behind it. Sign in to see the keys you hold. Your vault and activity open only when you sign.</p>
        <div className="dash-actions">
          <Button href="/start" size="lg" testid="dash-connect-cta">Start sign-in</Button>
          <Link className="dash-link" href="/judge" data-testid="dash-judge-link">See the judge path</Link>
        </div>
      </Card>
    </div>
  );
}
