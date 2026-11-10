import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { swapStep, SWAP_LABEL, type SwapInput } from "@/lib/swapFlow";

const base: SwapInput = {
  signedIn: true, lookingUp: false, keyMiss: false, hasKey: true, sessionLive: true,
  amountOk: true, samePair: false, quoteFresh: false, quoting: false, swapping: false, swapDone: false,
};
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("swap CTA follows the trade in order", () => {
  it("connect, then key, then unlock, then review, then sign, then pending and done", () => {
    expect(swapStep({ ...base, signedIn: false })).toBe("connect");
    expect(swapStep({ ...base, lookingUp: true })).toBe("checking");
    expect(swapStep({ ...base, hasKey: false, keyMiss: true })).toBe("get_key");
    expect(swapStep({ ...base, sessionLive: false })).toBe("unlock");
    expect(swapStep({ ...base, quoteFresh: false })).toBe("review");
    expect(swapStep({ ...base, quoteFresh: true })).toBe("confirm");
    expect(swapStep({ ...base, quoteFresh: true, swapping: true })).toBe("pending");
    expect(swapStep({ ...base, quoteFresh: true, swapDone: true })).toBe("done");
  });
  it("an empty or junk amount and a same-token pair block the button with a plain reason", () => {
    expect(swapStep({ ...base, amountOk: false })).toBe("enter_amount");
    expect(swapStep({ ...base, samePair: true })).toBe("same_pair");
    expect(SWAP_LABEL.enter_amount).toEqual({ label: "Enter an amount", enabled: false });
    expect(SWAP_LABEL.same_pair.enabled).toBe(false);
  });
  it("a quote in flight shows quoting, not review", () => {
    expect(swapStep({ ...base, quoting: true })).toBe("quoting");
  });
  it("a finished swap wins over every earlier step", () => {
    expect(swapStep({ ...base, signedIn: false, swapDone: true })).toBe("done");
  });
  it("labels never use jargon", () => {
    for (const v of Object.values(SWAP_LABEL)) expect(v.label).not.toMatch(/enclave|TEE|intent|1Click|nonce|NEP/i);
  });
});

describe("/swap screen wiring", () => {
  const view = src("../app/swap/view.tsx");
  it("runs the vault's trade paths: enclave quote with execute false, the signed swap, and the session", () => {
    expect(view).toContain('useSigned("quote")');
    expect(view).toContain('useSigned("swap")');
    expect(view).toContain("execute: false");
    expect(view).toContain("swapParamsById(fromId, toId, units, quoted.minOut)");
    expect(view).toContain("startSession(held.token.token_id)");
    expect(view).toContain('"/api/oneclick"');
  });
  it("offers the whole 1Click token list, with the vault two as the fallback", () => {
    expect(view).toContain("useTokenList()");
    expect(view).toContain("fallbackTokens()");
    expect(view).not.toMatch(/symbol: "(ETH|SOL|BTC)"/);
  });
  it("labels the no-wallet price as price only", () => {
    expect(view).toContain("Price only, nothing moves");
  });
  it("shows the balance only from a signed read, and offers Max only with one", () => {
    expect(view).toContain("balanceText ? (");
    expect(view).toMatch(/fromRaw && fromRaw !== "0" && \(/);
    expect(view).toContain('data-testid="swap-amount-max"');
  });
  it("the done state names the call and links to Verify through TxStatus", () => {
    expect(view).toContain('testid="trade-out"');
    expect(view).toContain("callId={swap.res.call_id ?? undefined}");
    expect(src("../components/TxResult.tsx")).toContain("/verify?call=");
  });
  it("recent swaps come from the signed history only after the log verifies", () => {
    expect(view).toContain("useLogVerified(history.res)");
    expect(view).toContain("Your recent swaps");
    expect(view).toContain("<summary>Public orders</summary>");
  });
  it("the page entry renders the view", () => {
    expect(src("../app/swap/page.tsx")).toContain("SwapView");
  });
});

describe("/swap receive field (production QA)", () => {
  it("the empty amount does not use the .empty class (design2.css paints .empty as a gradient panel)", () => {
    const v = src("../app/swap/view.tsx");
    expect(v).not.toContain('" empty"');
    expect(v).toContain('" is-empty"');
    expect(src("../app/swap/swap.css")).toContain(".sw-amt.is-empty");
  });
  it("the receive field shows a small USD line like the pay field", () => {
    expect(src("../app/swap/view.tsx")).toContain('className="sw-amt-usd"');
  });
});

describe("swap CTA when the amount is more than the balance, and with a live session", () => {
  it("reads Not enough <SYMBOL> (disabled) through the short step, not Enter an amount", () => {
    expect(swapStep({ ...base, amountOk: false, overBalance: true })).toBe("short");
    expect(swapStep({ ...base, amountOk: false, overBalance: false })).toBe("enter_amount");
    expect(SWAP_LABEL.short).toEqual({ label: "Not enough", enabled: false });
    expect(src("../app/swap/view.tsx")).toContain("`Not enough ${from.symbol}`");
  });
  it("labels the final step Swap now with a session, and keeps Confirm and sign without one", () => {
    expect(SWAP_LABEL.confirm.label).toBe("Confirm and sign");
    const v = src("../app/swap/view.tsx");
    expect(v).toContain(`step === "confirm" && sessionLive ? "Swap now" : cta.label`);
    expect(v).toContain("Runs through your unlocked session. No wallet popup.");
    expect(v).toContain(`testid="swap-cta"`);
  });
  it("names the receive chain under the receive panel when it is not NEAR", () => {
    const v = src("../app/swap/view.tsx");
    expect(v).toContain(`to.blockchain !== "near"`);
    expect(v).toContain("Lands in your vault as {to.symbol} on {chainName(to.blockchain)}. Withdraw supported NEAR assets only to your own NEAR account from the Vault.");
  });
});
