// Key sale rules: price parsing and limits, royalty and seller amounts, feature detection, the buy and list reasons.
import { describe, expect, it } from "vitest";
import {
  LIST_BALANCE_TEXT, LIST_MIN_BALANCE_YOCTO, buyBlockReason, isHolder, listBlockReason, nearText, parsePriceNear, royaltyOf,
  royaltyPercentText, sellerNetOf, supportFromError,
} from "@/lib/sale";
import { progressOf, levelUpOf, meterPct } from "@/lib/dashboard";

const NEAR = 10n ** 24n;

describe("parsePriceNear", () => {
  it("reads a NEAR amount into yoctoNEAR", () => {
    expect(parsePriceNear("5")).toEqual({ ok: true, yocto: 5n * NEAR });
    expect(parsePriceNear(" 0.25 ")).toEqual({ ok: true, yocto: NEAR / 4n });
  });
  it("enforces the contract minimum (0.1 NEAR) and cap (100 000 NEAR)", () => {
    expect(parsePriceNear("0.1")).toEqual({ ok: true, yocto: NEAR / 10n });
    expect(parsePriceNear("0.09")).toEqual({ ok: false, reason: "The minimum price is 0.1 NEAR." });
    expect(parsePriceNear("100000")).toEqual({ ok: true, yocto: 100_000n * NEAR });
    expect(parsePriceNear("100001")).toEqual({ ok: false, reason: "The maximum price is 100000 NEAR." });
  });
  it("refuses empty, negative and non-numeric input", () => {
    expect(parsePriceNear("").ok).toBe(false);
    expect(parsePriceNear("-1").ok).toBe(false);
    expect(parsePriceNear("five").ok).toBe(false);
  });
});

describe("nearText and the royalty split", () => {
  it("prints yoctoNEAR as NEAR without trailing zeros", () => {
    expect(nearText(5n * NEAR)).toBe("5");
    expect(nearText(NEAR / 4n)).toBe("0.25");
    expect(nearText("100000000000000000000000")).toBe("0.1");
  });
  it("takes the royalty rounded down, and the seller gets the rest", () => {
    expect(royaltyOf(10n * NEAR, 500)).toBe(NEAR / 2n);
    expect(sellerNetOf(10n * NEAR, 500)).toBe(NEAR * 9n + NEAR / 2n);
    expect(royaltyOf(3n, 500)).toBe(0n);
  });
  it("prints the royalty as a percentage", () => {
    expect(royaltyPercentText(500)).toBe("5%");
    expect(royaltyPercentText(250)).toBe("2.5%");
    expect(royaltyPercentText(0)).toBe("0%");
  });
});

describe("feature detection", () => {
  it("a MethodNotFound from the RPC means contract v2.3", () => {
    expect(supportFromError("wasm execution failed with error: FunctionCallError(MethodResolveError(MethodNotFound))")).toBe("v23");
  });
  it("any other failure is unknown, never v2.3", () => {
    expect(supportFromError("fetch failed")).toBe("unknown");
    expect(supportFromError("rpc")).toBe("unknown");
    expect(supportFromError("FunctionCallError(MethodResolveError(MethodInvalidSignature))")).toBe("unknown");
    expect(supportFromError("MethodResolveError")).toBe("unknown");
    expect(supportFromError("method not found")).toBe("unknown");
  });
});

describe("buyBlockReason", () => {
  const listing = { token_id: "k1", seller: "alice.near", price: "5" };
  const base = { signedIn: true, accountId: "bob.near", owner: "alice.near", listing, holdsKey: false, keysLoading: false };
  it("allows a buy from a signed-in visitor who holds no key and is not the seller", () => {
    expect(buyBlockReason(base)).toBeNull();
  });
  it("says why when the visitor is signed out", () => {
    expect(buyBlockReason({ ...base, signedIn: false, accountId: null })).toBe("Sign in to buy this key.");
  });
  it("refuses a visitor who already holds a key (one key per account)", () => {
    expect(buyBlockReason({ ...base, holdsKey: true })).toBe("This wallet already holds a key. One key per account.");
  });
  it("waits while the keys of the visitor are still being read", () => {
    expect(buyBlockReason({ ...base, keysLoading: true })).toMatch(/Checking/);
  });
  it("refuses the seller, and a listing whose seller no longer holds the key", () => {
    expect(buyBlockReason({ ...base, accountId: "alice.near" })).toMatch(/You are the seller/);
    expect(buyBlockReason({ ...base, owner: "carol.near" })).toMatch(/out of date/);
  });
});

describe("listBlockReason", () => {
  const ok = { signedIn: true, accountId: "alice.near", owner: "alice.near", royaltyBps: 500, balance: LIST_MIN_BALANCE_YOCTO };
  it("allows a list when the holder has the balance and the royalty is read", () => {
    expect(listBlockReason(ok)).toBeNull();
  });
  it("needs about 0.011 NEAR in the account, with the deposit and gas named", () => {
    expect(LIST_MIN_BALANCE_YOCTO).toBe(11n * 10n ** 21n);
    expect(listBlockReason({ ...ok, balance: LIST_MIN_BALANCE_YOCTO - 1n })).toBe(LIST_BALANCE_TEXT);
    expect(LIST_BALANCE_TEXT).toBe("You need about 0.011 NEAR in this account to list (0.01 NEAR refundable deposit + gas). On v2.5, first register the separate 0.0032 NEAR nonrefundable payout slot; sale and refund credits need a later cashout.");
  });
  it("says the balance is being read, or could not be read, instead of guessing", () => {
    expect(listBlockReason({ ...ok, balance: undefined })).toMatch(/Reading this account/);
    expect(listBlockReason({ ...ok, balance: null })).toMatch(/could not be read/);
  });
  it("refuses a non-holder and a missing royalty", () => {
    expect(listBlockReason({ ...ok, owner: "carol.near" })).toMatch(/Only the current holder/);
    expect(listBlockReason({ ...ok, royaltyBps: null })).toMatch(/royalty/);
  });
});

describe("isHolder", () => {
  it("is true only for the connected account that is the chain owner", () => {
    expect(isHolder("a.near", "a.near")).toBe(true);
    expect(isHolder("a.near", "b.near")).toBe(false);
    expect(isHolder(null, "a.near")).toBe(false);
    expect(isHolder("a.near", undefined)).toBe(false);
  });
});

describe("tier progress readers", () => {
  const good = { current: 1, next: 2, swaps: 3, volume_usd_micro: 1_000_000, swaps_needed: 10, volume_needed_usd_micro: 5_000_000, swaps_done: false, volume_done: false, met: false };
  it("accepts the enclave's progress shape", () => {
    expect(progressOf(good)).toEqual(good);
    expect(progressOf({ ...good, next: null })?.next).toBeNull();
  });
  it("returns null when a field is missing or the wrong type, so nothing is guessed", () => {
    expect(progressOf(null)).toBeNull();
    expect(progressOf({ ...good, swaps: undefined })).toBeNull();
    expect(progressOf({ ...good, met: "yes" })).toBeNull();
    expect(progressOf({ ...good, next: "2" })).toBeNull();
  });
  it("draws a bar from done over needed, clamped, and a zero target is full", () => {
    expect(meterPct(3, 10)).toBe(30);
    expect(meterPct(50, 10)).toBe(100);
    expect(meterPct(0, 0)).toBe(100);
  });
  it("reads a level up only when it sent a transaction", () => {
    expect(levelUpOf({ tier_before: 1, tier_after: 2, tx_hash: "T" })).toEqual({ tierBefore: 1, tierAfter: 2, txHash: "T" });
    expect(levelUpOf({ tier: 1, earned: 1, progress: good })).toBeNull();
  });
});
