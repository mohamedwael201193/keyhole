import { describe, expect, it } from "vitest";
import { formatTradePrice } from "@/lib/price";

describe("formatTradePrice", () => {
  it("prints a single dollar sign", () => {
    expect(formatTradePrice(1)).toBe("$1 / trade");
    expect(formatTradePrice(10)).toBe("$10 / trade");
    expect(formatTradePrice(100)).toBe("$100 / trade");
  });

  it("does not double the dollar sign", () => {
    for (const n of [1, 10, 100]) expect(formatTradePrice(n).startsWith("$$")).toBe(false);
  });
});
