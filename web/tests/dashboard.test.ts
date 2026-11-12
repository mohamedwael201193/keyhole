import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Overview, type ActivityView, type BalanceView, type KeysView, type OverviewProps, type UnlockView } from "@/components/dashboard/Overview";
import type { SignInOptionsProps } from "@/components/SignInModal";
import type { Token } from "@/lib/near";
import { amountText, capsOf, entryDetail, finishOf, keyCountText, kindLabel, settledOrders, type HistEntry } from "@/lib/dashboard";
import { assetRows, totalOf } from "@/lib/amount";
import { ASSETS } from "@/lib/assets";

const ACCT = "holder.keyhole.test";
const USDC = ASSETS.usdc.id;
const html = (p: Partial<OverviewProps>) => renderToStaticMarkup(createElement(Overview, { ...BASE, ...p } as OverviewProps));
const token = (id: string): Token => ({ token_id: id, owner_id: ACCT, metadata: null });

const keysReady = (count: number, tier: number | null = 1, capped = false): KeysView => ({
  status: "ready", count, capped, primary: count > 0 ? token("4") : null, tier, onRetry: () => {},
});
const keysLoading: KeysView = { status: "loading", count: 0, capped: false, primary: null, tier: null, onRetry: () => {} };
const unlockOff: UnlockView = { live: false, minutes: 0, busy: false, busyLabel: "", via: null, error: null, onUnlock: () => {} };
const unlockOn: UnlockView = { ...unlockOff, live: true, minutes: 27 };
const balanceUnread: BalanceView = { read: false, busy: false, busyLabel: "", total: null, rows: null, error: null, onRead: () => {} };
const activityUnread: ActivityView = { read: false, busy: false, busyLabel: "", entries: null, logOk: null, callId: null, error: null, onRead: () => {} };
const SIGN_IN: SignInOptionsProps = {
  socialEnabled: true, onGoogle: () => {}, onEmail: () => {}, onNear: () => {}, onMeteor: () => Promise.resolve(), onOther: () => {},
};
const BASE: OverviewProps = {
  accountId: ACCT, restoring: false, keys: keysReady(1), unlock: unlockOff, balance: balanceUnread, activity: activityUnread, signIn: SIGN_IN,
};

const usdcRows = (raw: string) => {
  const rows = assetRows([{ token: USDC, amount: raw }], {});
  return { rows, total: totalOf(rows) };
};
/** The opening tag of the element with this test id, so an href and a test id are checked on the same element. */
const tagOf = (m: string, id: string) => {
  const at = m.indexOf(`data-testid="${id}"`);
  expect(at, id).toBeGreaterThan(-1);
  return m.slice(m.lastIndexOf("<", at), m.indexOf(">", at) + 1);
};
/** The markup from one test id to the next top-level block, so an assertion stays inside its own card. */
const from = (m: string, id: string) => {
  const at = m.indexOf(`data-testid="${id}"`);
  expect(at, id).toBeGreaterThan(-1);
  return m.slice(at);
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

describe("Overview: signed out", () => {
  it("is one centred card: the sign-in rows inline, and a way to explore without a wallet", () => {
    const m = html({ accountId: null });
    expect(m).toContain("Open your <em>key</em>");
    expect(m).toContain('data-testid="dash-connect"');
    for (const id of ["choose-social", "choose-email", "choose-near", "signin-meteor", "choose-other"]) expect(m, id).toContain(`data-testid="${id}"`);
    expect(tagOf(m, "dash-explore")).toContain('href="/demo"');
    expect(m).not.toContain('data-testid="key-hero"');
    expect(m).not.toContain('data-testid="stat-balance"');
    expect(m).not.toContain("Sign to unseal");
  });

  it("hides Google and email when Privy is not configured", () => {
    const m = html({ accountId: null });
    expect(m).toContain('data-testid="choose-social"');
    const off = renderToStaticMarkup(createElement(Overview, { ...BASE, accountId: null, signIn: { ...SIGN_IN, socialEnabled: false } }));
    expect(off).not.toContain('data-testid="choose-social"');
    expect(off).toContain('data-testid="choose-near"');
  });

  it("while the wallet is restoring it shows a neutral skeleton, not the sign-in card", () => {
    const m = html({ accountId: null, restoring: true });
    expect(m).toContain('data-testid="dash-restoring"');
    expect(m).not.toContain("Open your <em>key</em>");
  });
});

describe("Overview: signed in, keys still loading", () => {
  it("names the wait and shows no number and no vault card", () => {
    const m = html({ keys: keysLoading });
    expect(m).toContain("Looking up your key");
    expect(m).toContain(ACCT);
    expect(m).not.toContain('data-testid="key-hero"');
    expect(m).not.toContain('data-testid="mint-banner"');
    expect(m).not.toContain('data-testid="dash-assets"');
    expect(m).not.toContain("kh-stat-value");
  });

  it("a failed key lookup says so and offers a retry, never a zero", () => {
    const m = html({ keys: { status: "error", count: 0, capped: false, primary: null, tier: null, onRetry: () => {} } });
    expect(m).toContain("Your keys did not load");
    expect(m).toContain('data-testid="dash-keys-retry"');
    expect(m).not.toContain('data-testid="mint-banner"');
    expect(m).not.toContain('data-testid="stat-keys"');
  });
});

describe("Overview: signed in, no key", () => {
  const m = html({ keys: keysReady(0, null) });

  it("the hero is Mint: one primary action to /mint, and a sample artwork labelled as one", () => {
    expect(m).toContain('data-testid="mint-banner"');
    expect(m).toContain("Mint your key");
    expect(tagOf(m, "dash-mint")).toContain('href="/dashboard#mint"');
    expect(m).toContain("Free. One signature. The enclave pays storage.");
    expect(m).toContain("Only Bronze is mintable today");
    expect(m).toContain('alt="Sample Bronze key artwork"');
  });

  it("the checklist names the key as the first open step, with its action", () => {
    expect(from(m, "setup-checklist")).toContain('data-testid="setup-key-action"');
    expect(tagOf(m, "setup-key-action")).toContain('href="/dashboard#mint"');
    expect(m).toContain('data-testid="setup-sign"');
    expect(m).not.toContain('data-testid="setup-complete"');
  });

  it("shows no vault, no assets and no activity without a key", () => {
    expect(m).not.toContain('data-testid="dash-assets"');
    expect(m).not.toContain('data-testid="dash-activity"');
    expect(m).not.toContain('data-testid="dash-unlock"');
  });

  it("shows a compact proof card for the holder's own calls: no build hash or contract (those are on /developers), and no verify link without a call", () => {
    expect(m).toContain('data-testid="ov-proof"');
    expect(m).toContain("Proof of your calls");
    const grid = m.split("v7-proof-grid")[1].split("</dl>")[0];
    expect(grid).not.toContain("Intel TDX");
    expect(grid).not.toContain("keyhole-devmo.near");
    expect(grid).not.toContain("Worker build");
    expect(tagOf(m, "ov-verify")).toContain("disabled");
    expect(tagOf(m, "ov-verify")).not.toContain("href=");
  });
});

describe("Overview: signed in with a key, vault locked", () => {
  const m = html({ keys: keysReady(1, 1) });

  it("the key card names the key and its tier, with the one sentence and the caps from the tier table", () => {
    expect(from(m, "key-hero")).toContain("Key #4");
    expect(m).toContain('data-testid="stat-tier">Bronze<');
    expect(m).toContain("Your NFT is the account: whoever holds the key controls the vault, and selling the key hands over the account.");
    expect(m).toContain("Caps: $1 a trade · $5 a day");
    expect(m).toMatch(/\/heirloom\/keys\/k(03|05|08)\.webp/);
  });

  it("the vault total is Sealed until a read, with one Unlock button that starts the session", () => {
    expect(m).toContain('data-testid="stat-balance">Sealed<');
    expect(m).toContain('data-testid="dash-unlock"');
    expect(m).toContain("One signature. 30 minutes.");
    expect(m).not.toContain('data-testid="dash-asset-list"');
  });

  it("the hero offers Swap, Deposit and Withdraw, with Swap secondary while locked", () => {
    expect(tagOf(m, "dash-swap")).toContain('href="/dashboard#swap"');
    expect(tagOf(m, "dash-deposit")).toContain('href="/dashboard#vault"');
    expect(tagOf(m, "dash-withdraw")).toContain('href="/dashboard#vault"');
  });

  it("the assets and activity cards carry one muted unlock line each, and no sign-to button", () => {
    expect(from(m, "dash-assets")).toContain('data-testid="dash-unlock-line"');
    expect(from(m, "dash-activity")).toContain('data-testid="dash-unlock-line"');
    expect(m).toContain("Unlock to read");
    expect(m).not.toContain("Sign to read");
    expect(m).not.toContain("Sign to unseal");
    expect(m.match(/data-testid="dash-unlock-line"/g)?.length).toBe(2);
  });

  it("the checklist shows Unlock as the open step and the rest as not yet", () => {
    expect(m).toContain('data-testid="setup-unlock-action"');
    expect(m).toContain('data-testid="setup-fund" data-done="0"');
    expect(m).toContain('data-testid="setup-swap" data-done="0"');
  });

  it("a tier that cannot be read shows no finish and no caps", () => {
    const u = html({ keys: keysReady(1, null) });
    expect(u).toContain("Tier not readable");
    expect(u).toContain("Caps: not readable for this tier right now");
    expect(u).not.toContain("$1 a trade");
  });

  it("Silver and Gold keys carry their own published caps", () => {
    expect(html({ keys: keysReady(1, 2) })).toContain("Caps: $10 a trade · $50 a day");
    expect(html({ keys: keysReady(1, 3) })).toContain("Caps: $100 a trade · $500 a day");
  });

  it("several keys say so, and the list full at the limit says 50 or more", () => {
    expect(html({ keys: keysReady(3, 1) })).toContain("Showing the first.");
    expect(html({ keys: keysReady(50, 1, true) })).toContain("50 or more");
  });
});

describe("Overview: signed in with a key, session live", () => {
  it("the vault total is the balance read, with the session label and no unlock button", () => {
    const { rows, total } = usdcRows("12340000");
    const m = html({ keys: keysReady(1, 1), unlock: unlockOn, balance: { ...balanceUnread, read: true, rows, total } });
    expect(m).toContain('data-testid="stat-balance">$12.34<');
    expect(m).not.toContain('data-testid="dash-unlock"');
    expect(m).toContain("Read with your session. No popup.");
    expect(tagOf(m, "dash-swap")).toContain('href="/dashboard#swap"');
    expect(m).toContain('data-testid="dash-asset-list"');
    expect(m).toContain(`data-token="${ASSETS.usdc.symbol}"`);
    expect(m).toContain('data-testid="dash-balance-refresh"');
    expect(m).not.toContain('data-testid="dash-unlock-line"');
  });

  it("while the balance is read the vault says so, and a failed read is shown with its code and a retry", () => {
    const reading = html({ keys: keysReady(1, 1), unlock: unlockOn, balance: { ...balanceUnread, busy: true, busyLabel: "Enclave is checking" } });
    expect(reading).toContain("Enclave is checking");
    const failed = html({ keys: keysReady(1, 1), unlock: unlockOn, balance: { ...balanceUnread, error: { code: "rate_limited", retry_after: 5 } } });
    expect(failed).toContain('data-code="rate_limited"');
    expect(failed).toContain('data-testid="dash-balance-retry"');
    expect(failed).toContain('data-testid="stat-balance">Unavailable<');
  });

  it("an empty vault says it is empty, with no zero asset rows", () => {
    const m = html({ keys: keysReady(1, 1), unlock: unlockOn, balance: { ...balanceUnread, read: true, rows: [], total: { kind: "empty" } } });
    expect(m).toContain('data-testid="dash-assets-empty"');
    expect(m).not.toContain('data-testid="dash-asset-list"');
  });

  it("an unlock error is shown with its code next to the Unlock button", () => {
    const m = html({ keys: keysReady(1, 1), unlock: { ...unlockOff, error: "wallet_rejected" } });
    expect(m).toContain('data-code="wallet_rejected"');
  });
});

describe("Overview: recent activity from the signed history", () => {
  const entries: HistEntry[] = [
    { ts_ms: 1_700_000_000_000, kind: "swap", token_in: USDC, amount_in: "2500000", token_out: "unknown.near", amount_out: "7", status: "success" },
    { ts_ms: 1_700_000_100_000, kind: "withdraw", token: USDC, amount: "1000000", chain: "base", status: "refunded" },
  ];
  const readOk = (over: Partial<ActivityView> = {}): ActivityView => ({ ...activityUnread, read: true, entries, logOk: true, callId: "abcdef1234567890", ...over });

  it("lists the newest entries with status badges, counts the settled swap, and links the read to /verify", () => {
    const m = html({ activity: readOk(), keys: keysReady(1, 1), unlock: unlockOn });
    expect(m).toMatch(/data-testid="stat-settled">Settled orders <b>1<\/b>/);
    const feed = from(m, "dash-feed");
    expect(feed.match(/<li /g)?.length).toBe(2);
    expect(feed).toContain("Success");
    expect(feed).toContain("Refunded");
    expect(feed).toContain("Withdraw");
    expect(m).toContain('href="/dashboard#proof/abcdef1234567890"');
    expect(m).toContain("abcdef12");
  });

  it("a log that does not verify shows no entries and counts nothing", () => {
    const m = html({ activity: readOk({ logOk: false }), keys: keysReady(1, 1), unlock: unlockOn });
    expect(m).toContain('data-testid="dash-log-hidden"');
    expect(m).not.toContain('data-testid="dash-feed"');
    expect(m).toMatch(/Settled orders <b>—<\/b>/);
  });

  it("while the log is checked it says so", () => {
    const m = html({ activity: readOk({ logOk: null }), keys: keysReady(1, 1), unlock: unlockOn });
    expect(m).toContain("Checking the log…");
  });

  it("an empty verified log is an honest empty state", () => {
    const m = html({ activity: readOk({ entries: [] }), keys: keysReady(1, 1), unlock: unlockOn });
    expect(m).toContain('data-testid="dash-empty"');
    expect(m).toContain("No trades on this key yet.");
    expect(m).toMatch(/data-testid="stat-settled">Settled orders <b>0<\/b>/);
  });

  it("a read error is shown", () => {
    const m = html({ activity: readOk({ error: { code: "session_expired" } }), keys: keysReady(1, 1), unlock: unlockOn });
    expect(m).toContain('data-code="session_expired"');
  });
});

describe("Overview: setup checklist from real state", () => {
  it("an empty funded-not-yet vault leaves Fund open and points to the vault", () => {
    const m = html({ keys: keysReady(1, 1), unlock: unlockOn, balance: { ...balanceUnread, read: true, rows: [], total: { kind: "empty" } } });
    expect(m).toContain('data-testid="setup-fund" data-done="0"');
    expect(tagOf(m, "setup-fund-action")).toContain('href="/dashboard#vault"');
  });

  it("a funded vault marks Fund done", () => {
    const { rows, total } = usdcRows("2500000");
    const m = html({ keys: keysReady(1, 1), unlock: unlockOn, balance: { ...balanceUnread, read: true, rows, total } });
    expect(m).toContain('data-testid="setup-fund" data-done="1"');
    expect(m).not.toContain('data-testid="setup-fund-action"');
  });

  it("all five done keeps the five steps listed as done (no collapse), with no actions, and the proof card stays", () => {
    const { rows, total } = usdcRows("2500000");
    const entries: HistEntry[] = [{ ts_ms: 1, kind: "swap", token_in: USDC, amount_in: "1", token_out: USDC, amount_out: "1", status: "success" }];
    const m = html({
      keys: keysReady(1, 1), unlock: unlockOn,
      balance: { ...balanceUnread, read: true, rows, total },
      activity: { ...activityUnread, read: true, entries, logOk: true, callId: "abcdef1234567890" },
    });
    expect(m).not.toContain('data-testid="setup-complete"');
    for (const id of ["sign", "key", "unlock", "fund", "swap"]) expect(m).toContain(`data-testid="setup-${id}" data-done="1"`);
    expect(m).toContain('data-testid="setup-count">5 of 5');
    expect(m).toContain("Swap done. Read from your signed activity.");
    expect(m).not.toMatch(/data-testid="setup-(key|unlock|fund|swap)-action"/);
    expect(m).toContain('data-testid="ov-proof"');
  });
});

describe("Overview: the page stays inside the design rules", () => {
  it("the overview stylesheet uses no !important and no literal colours (tokens only)", () => {
    const css = readFileSync(new URL("../app/overview.css", import.meta.url), "utf8");
    expect(css).not.toContain("!important");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("the page uses the shared key store and the one signed read path, not its own key lookup", () => {
    const v = readFileSync(new URL("../app/dashboard/view.tsx", import.meta.url), "utf8");
    expect(v).toContain('import { useKeyStore } from "@/lib/keyStore"');
    expect(v).not.toContain("useMyKeys");
    expect(v).toContain('useSigned("balance")');
    expect(v).toContain('useSigned("history")');
  });
});
