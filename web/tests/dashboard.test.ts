import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Overview, type ActivityView, type BalanceView, type KeysView, type OverviewProps } from "@/components/dashboard/Overview";
import { amountText, capsOf, entryDetail, finishOf, keyCountText, kindLabel, settledOrders, type HistEntry } from "@/lib/dashboard";
import { assetRows, totalOf } from "@/lib/amount";
import { ASSETS } from "@/lib/assets";

const ACCT = "holder.keyhole.test";
const USDC = ASSETS.usdc.id;
const html = (p: Partial<OverviewProps>) => renderToStaticMarkup(createElement(Overview, { ...BASE, ...p } as OverviewProps));
/** The markup of one stat card, from its test id to the start of the next card. */
const card = (m: string, id: string) => {
  const from = m.indexOf(`data-testid="${id}"`);
  expect(from, id).toBeGreaterThan(-1);
  const next = m.indexOf('data-testid="stat-', from + 1);
  return m.slice(from, next === -1 ? undefined : next);
};

const keysReady = (count: number, tier: number | null = 1, capped = false): KeysView => ({ status: "ready", count, capped, tier, onRetry: () => {} });
const keysLoading: KeysView = { status: "loading", count: 0, capped: false, tier: null, onRetry: () => {} };
const balanceUnread: BalanceView = { read: false, busy: false, busyLabel: "", sessionLive: false, total: null, rows: null, error: null, onSign: () => {} };
const activityUnread: ActivityView = { read: false, busy: false, busyLabel: "", entries: null, logOk: null, callId: null, error: null, onRead: () => {} };
const BASE: OverviewProps = { accountId: ACCT, restoring: false, keys: keysReady(1), balance: balanceUnread, activity: activityUnread };

const usdcRows = (raw: string) => {
  const rows = assetRows([{ token: USDC, amount: raw }], {});
  return { rows, total: totalOf(rows) };
};

describe("pure helpers", () => {
  it("maps a tier to its finish and caps, the same table the vault uses", () => {
    expect(finishOf(3)).toBe("Gold");
    expect(finishOf(2)).toBe("Silver");
    expect(finishOf(1)).toBe("Bronze");
    expect(finishOf(null)).toBe("Bronze");
    expect(capsOf(1)).toEqual({ perTx: 1, daily: 5 });
    expect(capsOf(3)).toEqual({ perTx: 100, daily: 500 });
    expect(capsOf(null)).toBeNull();
    expect(capsOf(0)).toBeNull();
  });

  it("counts keys plainly, and says 50 or more only when the list is full", () => {
    expect(keyCountText(3, false)).toBe("3");
    expect(keyCountText(0, false)).toBe("0");
    expect(keyCountText(50, true)).toBe("50 or more");
  });

  it("counts settled orders: successful swaps and copy trades only", () => {
    const e = (kind: string, status: string): HistEntry => ({ kind, status });
    expect(settledOrders([e("swap", "success"), e("copy", "success"), e("swap", "failed"), e("withdraw", "success")])).toBe(2);
    expect(settledOrders([])).toBe(0);
  });

  it("shows base units as the asset's own amount, and a dash when there is none", () => {
    expect(amountText("2500000", USDC)).toBe(`${(2500000 / 10 ** ASSETS.usdc.decimals).toString()} ${ASSETS.usdc.symbol}`);
    expect(amountText(null, USDC)).toBe("—");
    expect(amountText("7", "unknown.near")).toBe("7 unknown.near");
  });

  it("describes a swap as from → to, with both amounts", () => {
    const d = entryDetail({ kind: "swap", token_in: USDC, amount_in: "2500000", token_out: "unknown.near", amount_out: "7" });
    expect(d).toBe(`2.5 ${ASSETS.usdc.symbol} → 7 unknown.near`);
    expect(kindLabel("copy")).toBe("Copy trade");
    expect(kindLabel(undefined)).toBe("Entry");
  });
});

describe("Overview: not connected", () => {
  it("shows the calm hero with a 3D sign-in button and the judge link", () => {
    const m = html({ accountId: null });
    expect(m).toContain("Connect to see your keys");
    expect(m).toMatch(/href="\/start"/);
    expect(m).toMatch(/href="\/judge"/);
    expect(m).toContain("kh-btn--primary");
    expect(m).not.toContain('data-testid="stat-keys"');
  });

  it("while the wallet is restoring it shows a neutral skeleton, not the connect hero", () => {
    const m = html({ accountId: null, restoring: true });
    expect(m).toContain('data-testid="dash-restoring"');
    expect(m).not.toContain("Connect to see your keys");
  });
});

describe("Overview: connected, keys still loading", () => {
  it("names the wait and shows no number", () => {
    const m = html({ keys: keysLoading });
    expect(m).toContain("Looking up your keys…");
    expect(m).toContain(ACCT);
    expect(m).not.toContain('class="kh-stat-value"');
    expect(m).not.toContain('data-testid="mint-banner"');
    expect(m).not.toContain('data-testid="dash-assets"');
  });
});

describe("Overview: connected, no key", () => {
  const m = html({ keys: keysReady(0, null) });

  it("shows zero keys as a real count, and the mint banner", () => {
    expect(card(m, "stat-keys")).toMatch(/kh-stat-value">0</);
    expect(m).toContain('data-testid="mint-banner"');
    expect(m).toContain("Mint your key");
    expect(m).toMatch(/href="\/mint"/);
    expect(m).toContain("only Bronze is mintable today.");
  });

  it("no tier, no caps and no vault prompt without a key", () => {
    expect(card(m, "stat-tier")).toContain("No key yet");
    expect(card(m, "stat-tier")).not.toContain("kh-stat-value");
    expect(card(m, "stat-balance")).toContain("Mint a key to open a vault");
    expect(card(m, "stat-balance")).not.toContain('data-testid="dash-unseal"');
    expect(m).not.toContain('data-testid="stat-settled"');
    expect(m).not.toContain('data-testid="dash-activity"');
  });
});

describe("Overview: connected with a key", () => {
  it("shows the tier and its published caps; the vault balance waits for a signature", () => {
    const m = html({ keys: keysReady(1, 1) });
    expect(card(m, "stat-keys")).toMatch(/kh-stat-value">1</);
    expect(card(m, "stat-tier")).toMatch(/kh-stat-value">Bronze</);
    expect(card(m, "stat-tier")).toContain("$1 a trade · $5 a day");
    expect(card(m, "stat-balance")).not.toContain("kh-stat-value");
    expect(card(m, "stat-balance")).toContain('data-testid="dash-unseal"');
    expect(card(m, "stat-balance")).toContain("Sign to unseal");
    expect(m).not.toContain('data-testid="mint-banner"');
    expect(m).toContain('data-testid="dash-assets"');
    expect(m).toContain("Assets appear here after you sign");
    expect(m).toContain('data-testid="dash-activity"');
    expect(m).toContain("Sign to read");
  });

  it("the settled count waits for the history read and says so", () => {
    const m = html({ keys: keysReady(1, 1) });
    expect(card(m, "stat-settled")).toContain("Read activity to count them");
    expect(card(m, "stat-settled")).not.toContain("kh-stat-value");
  });

  it("a stored tier with a key reads as Gold for tier 3", () => {
    expect(html({ keys: keysReady(1, 3) })).toMatch(/kh-stat-value">Gold</);
  });

  it("a key whose tier cannot be read shows no tier value", () => {
    const m = html({ keys: keysReady(1, null) });
    expect(card(m, "stat-tier")).toContain("Tier not readable right now");
    expect(card(m, "stat-tier")).not.toContain("kh-stat-value");
  });

  it("a failed key lookup says so and offers a retry, never a zero", () => {
    const m = html({ keys: { status: "error", count: 0, capped: false, tier: null, onRetry: () => {} } });
    expect(card(m, "stat-keys")).toContain('data-testid="dash-keys-retry"');
    expect(card(m, "stat-keys")).not.toContain("kh-stat-value");
    expect(m).not.toContain('data-testid="mint-banner"');
  });
});

describe("Overview: vault balance after a signed read", () => {
  it("shows the USD total and the asset list with the token mark", () => {
    const { rows, total } = usdcRows("12340000");
    const m = html({ balance: { ...balanceUnread, read: true, rows, total }, keys: keysReady(1, 1) });
    expect(card(m, "stat-balance")).toMatch(/kh-stat-value">\$12\.34</);
    expect(m).toContain('data-testid="dash-asset-list"');
    expect(m).toContain(`data-token="${ASSETS.usdc.symbol}"`);
    expect(m).toContain('data-icon="usdc"');
    expect(m).toContain('data-testid="dash-balance-refresh"');
    expect(m).not.toContain("Assets appear here after you sign");
  });

  it("an empty vault says it is empty, with no zero asset rows", () => {
    const m = html({ balance: { ...balanceUnread, read: true, rows: [], total: { kind: "empty" } }, keys: keysReady(1, 1) });
    expect(m).toContain('data-testid="dash-assets-empty"');
    expect(m).not.toContain('data-testid="dash-asset-list"');
  });

  it("a read error is shown with its code, not hidden", () => {
    const m = html({ balance: { ...balanceUnread, error: { code: "rate_limited", retry_after: 5 } }, keys: keysReady(1, 1) });
    expect(m).toContain('data-code="rate_limited"');
  });

  it("the session label replaces the signature label once a session is live", () => {
    const m = html({ balance: { ...balanceUnread, sessionLive: true }, keys: keysReady(1, 1) });
    expect(m).toContain("Unseal (session, no popup)");
  });
});

describe("Overview: recent activity from the signed history", () => {
  const entries: HistEntry[] = [
    { ts_ms: 1_700_000_000_000, kind: "swap", token_in: USDC, amount_in: "2500000", token_out: "unknown.near", amount_out: "7", status: "success" },
    { ts_ms: 1_700_000_100_000, kind: "withdraw", token: USDC, amount: "1000000", chain: "base", status: "refunded" },
  ];
  const readOk = (over: Partial<ActivityView> = {}): ActivityView => ({ ...activityUnread, read: true, entries, logOk: true, callId: "abcdef1234567890", ...over });

  it("lists the newest entries with status badges, counts the settled swap, and links the read to /verify", () => {
    const m = html({ activity: readOk(), keys: keysReady(1, 1) });
    expect(card(m, "stat-settled")).toMatch(/kh-stat-value">1</);
    expect(m).toContain('data-testid="dash-feed"');
    const feed = m.slice(m.indexOf('data-testid="dash-feed"'));
    expect(feed.match(/<li /g)?.length).toBe(2);
    expect(feed).toContain("Success");
    expect(feed).toContain("Refunded");
    expect(feed).toContain("Withdraw");
    expect(m).toContain('href="/verify?call=abcdef1234567890"');
    expect(m).toContain("call abcdef12");
  });

  it("a log that does not verify shows no entries and does not count settled orders", () => {
    const m = html({ activity: readOk({ logOk: false }), keys: keysReady(1, 1) });
    expect(m).toContain('data-testid="dash-log-hidden"');
    expect(m).not.toContain('data-testid="dash-feed"');
    expect(card(m, "stat-settled")).toContain("Not counted: the log did not verify.");
  });

  it("while the log is checked it says so", () => {
    const m = html({ activity: readOk({ logOk: null }), keys: keysReady(1, 1) });
    expect(m).toContain("Checking the log…");
    expect(card(m, "stat-settled")).toContain("Checking the log…");
  });

  it("an empty verified log is an honest empty state", () => {
    const m = html({ activity: readOk({ entries: [] }), keys: keysReady(1, 1) });
    expect(m).toContain('data-testid="dash-empty"');
    expect(m).toContain("No trades on this key yet.");
    expect(card(m, "stat-settled")).toMatch(/kh-stat-value">0</);
  });

  it("a read error is shown", () => {
    const m = html({ activity: readOk({ error: { code: "session_expired" } }), keys: keysReady(1, 1) });
    expect(m).toContain('data-code="session_expired"');
  });
});
