import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { compactAccount } from "@/lib/near";
import { networkPillDetail, networkPillLabel } from "@/lib/networkLabel";
import { accountAccess, assetPresentation, cairoTime, cashoutCopy, currentStep, disbursementCopy, floorCaption, humanSeconds, loanStateLabel, pendingCashoutChrome, policyAction, terminalLabel, unlockNotice } from "@/lib/pledgeCopy";
import type { LoanState as LoanStateType } from "@/lib/pledgeClient";
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
    const freezing = accountAccess({ readable: true, pledged: false, unlocking: false, freezing: true, epoch: "0" });
    expect(freezing.label).toBe("Lock not confirmed");
    expect(freezing.detail).not.toContain("Custody frozen");
  });

  it("tells the new holder and the previous holder different default-unlock sentences", () => {
    const yours = unlockNotice("default_claimed", true);
    const moved = unlockNotice("default_claimed", false);
    expect(yours.text).toBe("Loan defaulted. The key is yours; final unlock is still finishing, so please wait before moving it.");
    expect(moved.text).toBe("Transferred to the new holder. Your private access has ended.");
    expect(moved.text).not.toContain("wait before moving");
    expect(yours.technical).toContain("default_claimed");
    expect(unlockNotice("repaid", true).text).toContain("Repaid");
    expect(unlockNotice("repaid", false).text).toContain("not yours to move");
    expect(unlockNotice(null, false).technical).toContain("Resolution committed");
  });

  it("keeps an unknown-decimal amount out of the headline and a known amount with its symbol", () => {
    const raw = assetPresentation({ token: "nep141:unpriced.test.near", amount: "123", symbol: "UNPRICED" }, null);
    expect(raw).toMatchObject({ name: "Other token", amount: "Value unknown", note: "Included in your collateral", extra: "Amount unavailable in token units", copyId: true });
    expect(raw.amount).not.toContain("123");
    expect(raw.amount).not.toContain("nep141");
    expect(raw.tip).toContain("nep141:unpriced.test.near");
    expect(raw.tip).toContain("123 base units");
    expect(raw.tip).toContain("decimals unavailable");
    const usdc = assetPresentation({ token: "nep141:usdc.test", amount: "500000", symbol: "USDC", decimals: 6 }, "0.5");
    expect(usdc).toMatchObject({ name: "USDC", amount: "0.5", extra: "", copyId: false });
    expect(usdc.note).toContain("Price not quoted");
    const missing = assetPresentation({ token: "nep141:nor.example.near", amount: "1230000", decimals: 6 }, "1.23");
    const placeholder = assetPresentation({ token: "nep141:0123456789abcdef.example.near", amount: "1230000", symbol: "UNPRICED", decimals: 6 }, "1.23");
    for (const row of [missing, placeholder]) {
      expect(row.amount).toBe("1.23");
      expect(row.name).not.toMatch(/nep141/i);
      expect(row.name).not.toBe("UNPRICED");
      expect(row.name).not.toBe("Other token");
      expect(row.note).toContain("Price not quoted");
      expect(row.copyId).toBe(true);
      expect(row.tip).toContain(row === missing ? "nep141:nor.example.near" : "nep141:0123456789abcdef.example.near");
    }
    expect(missing.name).toBe("nor.example.near");
    expect(placeholder.name).toBe("01234567…near");
  });

  it("maps every phase to borrower and lender copy, and never tells a lender to claim principal", () => {
    const states = ["Freezing", "Offered", "DisbursementPending", "Active", "UnlockPending"] as const;
    const seen = new Set<string>();
    for (const state of states) {
      for (const actor of ["borrower", "lender"] as const) {
        const owns = actor === "borrower";
        seen.add(`${state}:${actor}`);
        const step = currentStep(state, owns);
        expect(step.startsWith("Now:")).toBe(true);
        if (state === "Freezing") {
          expect(policyAction(state, "retry")).toBe("Retry account lock");
          expect(policyAction(state, "check")).toBe("Check lock status");
          expect(policyAction(state, "unknown").toLowerCase()).not.toContain("unlock");
          expect(step.toLowerCase()).not.toContain("unlock");
        }
        if (state === "UnlockPending") {
          expect(policyAction(state, "retry")).toBe("Retry account unlock");
          expect(policyAction(state, "check")).toBe("Check unlock status");
          expect(policyAction(state, "unknown")).toContain("pending / UNKNOWN");
        }
        if (state === "DisbursementPending") {
          const copy = disbursementCopy(owns, "0.01");
          expect(copy.heading).toBe(owns ? "Claim the loan" : "Waiting for the borrower");
          if (!owns) {
            expect(copy.text).toBe("Waiting for borrower to claim. No repayment clock yet. A failed or UNKNOWN cashout starts no debt.");
            expect(copy.text).not.toContain("your wallet");
            expect(copy.heading).not.toContain("Claim");
          } else {
            expect(copy.text).toContain("Claim 0.01 NEAR");
            expect(copy.text).toContain("delivery is confirmed");
          }
        }
      }
    }
    expect(seen.size).toBe(10);
    expect(loanStateLabel("Freezing" satisfies LoanStateType)).toBe("Locking account…");
  });

  it("treats a pending cashout as unconfirmed, including after a send whose callback is absent", () => {
    const pending = cashoutCopy({ pending: true, amount: "0.01", nonce: "7" });
    expect(pending.title).toBe("Cashout pending; checking chain");
    expect(pending.detail.toLowerCase()).not.toContain("still held");
    expect(pending.detail).not.toMatch(/\bdelivered\b|\bconfirmed\b/);
    expect(pending.detail).not.toContain("nonce");
    expect(pending.technical).toContain("nonce 7");
    const ready = cashoutCopy({ pending: false, amount: "0.0101", nonce: null });
    expect(ready.detail).toContain("Still held by the contract");
    expect(ready.title).toContain("0.0101 NEAR ready to withdraw");
    for (const owns of [true, false]) {
      const chrome = pendingCashoutChrome(owns);
      const blob = `${chrome.badge} ${chrome.step} ${chrome.heading} ${chrome.text}`;
      expect(blob.toLowerCase()).not.toContain("claim");
      expect(chrome.step).toBe("Now: check the chain");
      expect(chrome.text).toContain("Wait and check the chain");
      expect(chrome.text).toContain("Do not send again");
      expect(blob).not.toMatch(/\bdelivered\b|\bconfirmed\b/);
    }
    const page = readFileSync(new URL("../app/pledge/LivePledge.tsx", import.meta.url), "utf8");
    expect(page).toContain("pendingCashoutChrome");
    expect(page).toContain("{payoutPending?null:");
    expect(page).toContain("Original money operation {operation.status}");
  });

  it("keeps seconds in the Cairo deadline and leaves a zero due date unstarted", () => {
    expect(cairoTime("0")).toBe("Not started");
    const ns = (BigInt(Date.UTC(2026, 0, 15, 10, 11, 12)) * 1_000_000n).toString();
    const shown = cairoTime(ns);
    expect(shown).toContain("12");
    expect(shown.endsWith("Cairo")).toBe(true);
    expect(shown).toMatch(/\d{2}:\d{2}:\d{2}/);
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
    expect(css).not.toMatch(/font-size:\s*(?:[1-9]|10|11)px/);
    expect(css).toMatch(/min-height:\s*44px/);
    const mobile = css.slice(css.indexOf("@media (max-width: 650px)"));
    expect(mobile).toContain("font-size: 14px");
    expect(mobile).toContain("font-size: 12px");
    expect(mobile).not.toContain("font-size: 11px");
    expect(mobile).toContain("min-height: 44px");
  });
});
