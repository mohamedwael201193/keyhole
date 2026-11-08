import { describe, expect, it } from "vitest";
import { isOrderVisible, orderKey, orderWindowEnd, parseOrder, readOrder, removeOrder, writeOrder, ORDER_GRACE_MS, type SavedOrder } from "@/lib/fundOrder";

const ACC = "holder.near";
const TOK = "4";
const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const order = (over: Partial<SavedOrder> = {}): SavedOrder => ({
  account: ACC, tokenId: TOK, depositAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", depositMemo: null, originSymbol: "USDC",
  originChain: "base", amountIn: "1.02", destSymbol: "USDC", amountOut: "1", deadline: "2026-11-08T12:30:00.000Z", timeWhenInactive: null,
  createdAt: NOW, ...over,
});

/** An in-memory Storage stand-in. */
function fakeStore(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

describe("saved from-another-chain order: storage", () => {
  it("round-trips one order per account and holder key", () => {
    const s = fakeStore();
    expect(writeOrder(order(), s)).toBe(true);
    expect(readOrder(ACC, TOK, s)).toEqual(order());
    expect(readOrder(ACC, "5", s)).toBeNull();
    expect(readOrder("other.near", TOK, s)).toBeNull();
    expect(orderKey(ACC, TOK)).toBe("kh.fundOrder:holder.near:4");
    removeOrder(ACC, TOK, s);
    expect(readOrder(ACC, TOK, s)).toBeNull();
  });

  it("drops a payload that is malformed or belongs to another key", () => {
    expect(readOrder(ACC, TOK, fakeStore({ [orderKey(ACC, TOK)]: "{not json" }))).toBeNull();
    expect(readOrder(ACC, TOK, fakeStore({ [orderKey(ACC, TOK)]: JSON.stringify({ ...order(), account: "x.near" }) }))).toBeNull();
    expect(readOrder(ACC, TOK, fakeStore({ [orderKey(ACC, TOK)]: JSON.stringify({ ...order(), createdAt: "now" }) }))).toBeNull();
  });

  it("treats a blocked or throwing store as no order and never throws", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
    expect(readOrder(ACC, TOK, broken)).toBeNull();
    expect(writeOrder(order(), broken)).toBe(false);
    expect(() => removeOrder(ACC, TOK, broken)).not.toThrow();
    expect(readOrder(ACC, TOK, null)).toBeNull();
  });

  it("parseOrder accepts exactly the stored shape", () => {
    expect(parseOrder(order())).toEqual(order());
    expect(parseOrder(null)).toBeNull();
    expect(parseOrder({ ...order(), depositMemo: 5 })).toBeNull();
  });
});

describe("saved from-another-chain order: visibility", () => {
  it("is window end at the quote deadline plus one hour", () => {
    expect(orderWindowEnd(order())).toBe(Date.parse("2026-11-08T12:30:00.000Z") + ORDER_GRACE_MS);
    expect(orderWindowEnd(order({ deadline: null }))).toBe(NOW + 30 * 60_000 + ORDER_GRACE_MS);
  });

  it("shows inside the window, whatever the status", () => {
    expect(isOrderVisible(order(), null, NOW)).toBe(true);
    expect(isOrderVisible(order(), "SUCCESS", NOW)).toBe(true);
  });

  it("after the window: shows only while the status is non-terminal", () => {
    const late = Date.parse("2026-11-08T14:00:00.000Z");
    expect(isOrderVisible(order(), null, late)).toBe(false);
    expect(isOrderVisible(order(), "PROCESSING", late)).toBe(true);
    expect(isOrderVisible(order(), "PENDING_DEPOSIT", late)).toBe(true);
    expect(isOrderVisible(order(), "REFUNDED", late)).toBe(false);
    expect(isOrderVisible(order(), "SUCCESS", late)).toBe(false);
  });
});
