import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { compactAccount } from "@/lib/near";
import { networkPillDetail, networkPillLabel } from "@/lib/networkLabel";
import { accountAccess, assetPresentation, floorCaption, humanSeconds, loanStateLabel, terminalLabel, unlockNotice } from "@/lib/pledgeCopy";
import { LivePledge } from "@/app/pledge/LivePledge";

vi.mock("@/lib/wallet", () => ({ useWallet: () => ({ accountId: null, pending: null, connect() {} }) }));

describe("pledge status labels", () => {
  it("maps every loan state to a plain label and leaves an unknown state untouched", () => {
    expect(loanStateLabel("Freezing")).toBe("Locking account…");
    expect(loanStateLabel("Offered")).toBe("Offer open");
    expect(loanStateLabel("DisbursementPending")).toBe("Funds ready to claim");
    expect(loanStateLabel("Active")).toBe("Loan active");
    expect(loanStateLabel("UnlockPending")).toBe("Unlocking…");
    expect(loanStateLabel("SomethingElse")).toBe("SomethingElse");
  });

  it("maps recorded endings and keeps a missing resolution unverified", () => {
    expect(terminalLabel("repaid")).toBe("Repaid · unlock confirmed");
    expect(terminalLabel("default_claimed")).toBe("Loan defaulted · unlock confirmed");
    expect(terminalLabel("canceled")).toBe("Canceled · unlock confirmed");
    expect(terminalLabel(null)).toBe("Closed · history unverified");
    expect(terminalLabel("unexpected")).toBe("Closed · history unverified");
  });

  it("describes account access without putting the epoch in the main label", () => {
    expect(accountAccess({ readable: false, pledged: false, unlocking: false, epoch: null })).toEqual({ label: "Unavailable", detail: "Chain read missing" });
    expect(accountAccess({ readable: true, pledged: true, unlocking: false, epoch: "0" })).toEqual({ label: "Locked while pledged", detail: "Custody frozen · owner epoch 0" });
    expect(accountAccess({ readable: true, pledged: false, unlocking: true, epoch: "1" }).label).toBe("Unlocking");
    expect(accountAccess({ readable: true, pledged: false, unlocking: false, epoch: "2" }).label).toBe("Available");
  });

  it("tells the new holder and the previous holder different default-unlock sentences", () => {
    const yours = unlockNotice("default_claimed", true);
    const moved = unlockNotice("default_claimed", false);
    expect(yours.text).toBe("Loan defaulted. The key is yours; final unlock is still finishing, so please wait before moving it.");
    expect(moved.text).toContain("moved to the new holder");
    expect(yours.technical).toContain("default_claimed");
    expect(unlockNotice("repaid", true).text).toContain("Repaid");
    expect(unlockNotice(null, false).technical).toContain("Resolution committed");
  });

  it("shows an unpriced amount as a shortened id plus raw units, and a known amount with its symbol", () => {
    const raw = assetPresentation({ token: "nep141:unpriced.test.near", amount: "123", symbol: "UNPRICED" }, null);
    expect(raw.name).toBe("Unpriced token");
    expect(raw.amount).toBe("nep141:unp…near · 123 raw units");
    expect(raw.tip).toContain("nep141:unpriced.test.near");
    expect(raw.tip).toContain("decimals unavailable");
    expect(raw.note).toContain("not normalized");
    const usdc = assetPresentation({ token: "nep141:usdc.test", amount: "500000", symbol: "USDC", decimals: 6 }, "0.5");
    expect(usdc).toMatchObject({ name: "USDC", amount: "0.5" });
    expect(usdc.note).toContain("Price not quoted");
  });

  it("names the floor honestly and keeps exact short durations", () => {
    expect(floorCaption("proposed")).toBe("Declared, not yet verified");
    expect(floorCaption("offered")).toContain("Minimum to verify");
    expect(floorCaption("verified")).toBe("Verified minimum · sealed signature verified");
    expect(floorCaption("funded")).toContain("not a current balance");
    expect(humanSeconds("7200")).toBe("2 hours");
    expect(humanSeconds("900")).toBe("15 minutes");
    expect(humanSeconds("90")).toBe("1 minute 30 seconds");
  });
});

describe("network and account chrome", () => {
  it("says Sandbox only for a sandbox build, and NEAR mainnet only otherwise", () => {
    expect(networkPillLabel(true)).toBe("Sandbox");
    expect(networkPillLabel(true)).not.toContain("mainnet");
    expect(networkPillDetail(true)).toBe("NEAR sandbox · custody simulated");
    expect(networkPillLabel(false)).toBe("NEAR mainnet");
    expect(networkPillDetail(false)).toBe("NEAR mainnet");
  });

  it("keeps both ends of a long account name", () => {
    expect(compactAccount("ui-borrower.test.near")).toBe("ui-bor…test");
    expect(compactAccount("bob.near")).toBe("bob");
    expect(compactAccount("a".repeat(64))).toBe("aaaa…aaaa");
  });
});

describe("pledge copy in the live page", () => {
  it("hides the swap comparison from the lender and offers a calm disclosure to the borrower", () => {
    const lender = renderToStaticMarkup(createElement(LivePledge, { tokenId: "k1", role: "lender" }));
    const borrower = renderToStaticMarkup(createElement(LivePledge, { tokenId: "k1", role: "borrower" }));
    expect(lender).not.toContain("Compare with a swap");
    expect(lender).not.toContain("savings estimate");
    expect(borrower).toContain("Compare with a swap");
    expect(borrower).toContain("no savings estimate is shown");
    expect(borrower).not.toContain("Live same-ledger swap quote unavailable");
    expect(borrower).toContain("Borrow NEAR. Keep your vault private.");
  });

  it("derives the header network pill from the sandbox flag", () => {
    const shell = readFileSync(new URL("../components/app/AppShell.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../app/app-shell.css", import.meta.url), "utf8");
    expect(shell).toContain("networkPillLabel(PLEDGE_SANDBOX)");
    expect(shell).not.toContain(">NEAR mainnet<");
    expect(css).toContain(".sandbox-banner + .app .app-top { top: 28px; }");
    expect(css).toContain("font: 600 12px/1.2");
  });

  it("keeps mobile type at least 11px and controls at least 40px tall", () => {
    const css = readFileSync(new URL("../app/pledge/live.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/font-size:\s*(?:[1-9]|10)px/);
    expect(css).toMatch(/min-height:\s*40px/);
    const mobile = css.slice(css.indexOf("@media (max-width: 650px)"));
    expect(mobile).toContain("font-size: 12px");
    expect(mobile).toContain("font-size: 11px");
    expect(mobile).toContain("min-height: 40px");
  });
});
