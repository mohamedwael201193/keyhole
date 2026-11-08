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
    expect(view).toContain("swapParams(from, to, units, quoted.minOut)");
    expect(view).toContain("startSession(held.token.token_id)");
    expect(view).toContain('"/api/oneclick"');
  });
  it("offers only the two assets the trade supports", () => {
    expect(view).toContain("Object.keys(ASSETS)");
    expect(view).not.toMatch(/symbol: "(ETH|SOL|BTC)"/);
  });
  it("labels the no-wallet price as price only", () => {
    expect(view).toContain("Price only, nothing moves");
  });
  it("shows the balance only from a signed read, and offers Max only with one", () => {
    expect(view).toContain("balanceText ?? undefined");
    expect(view).toMatch(/onMax=\{fromRaw && fromRaw !== "0"/);
  });
  it("the done state names the call and links to Verify through TxStatus", () => {
    expect(view).toContain('testid="trade-out"');
    expect(view).toContain("callId={swap.res.call_id ?? undefined}");
    expect(src("../components/TxResult.tsx")).toContain("/verify?call=");
  });
  it("recent swaps come from the signed history only after the log verifies", () => {
    expect(view).toContain("useLogVerified(history.res)");
    expect(view).toContain("Recent public orders");
  });
  it("the page entry renders the view", () => {
    expect(src("../app/swap/page.tsx")).toContain("SwapView");
  });
});
