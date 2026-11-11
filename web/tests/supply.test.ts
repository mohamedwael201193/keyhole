import { describe, expect, it } from "vitest";
import { holderSupply } from "@/lib/supply";

describe("holderSupply", () => {
  it("keeps the home count at minted minus the contract-held test key", () => {
    expect(holderSupply("6", "1")).toEqual({ supply: 5, minted: 6, excluded_test_keys: 1 });
  });
  it("accepts zero and refuses a negative, a gap, and an unsafe integer", () => {
    expect(holderSupply("0", "0")).toEqual({ supply: 0, minted: 0, excluded_test_keys: 0 });
    expect(holderSupply("1", "2")).toBeNull();
    expect(holderSupply("-1", "0")).toBeNull();
    expect(holderSupply(String(Number.MAX_SAFE_INTEGER + 1), "0")).toBeNull();
    expect(holderSupply("nope", "0")).toBeNull();
  });
});
