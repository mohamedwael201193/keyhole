import { describe, expect, it } from "vitest";
import { clearFailedSwaps, listFailedSwaps, recordFailedSwap, type FailedSwap } from "@/lib/failedSwaps";

function fakeStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

const failed = (callId: string): FailedSwap => ({
  callId,
  entry: { kind: "swap", status: "failed", ts_ms: 1_000, token_in: "usdc", token_out: "wnear", amount_in: "10000", amount_out: null },
  code: "native_unknown",
});

describe("failedSwaps", () => {
  it("records one failed attempt and lists it newest first", () => {
    const store = fakeStore();
    expect(listFailedSwaps("fs-a.near", store)).toEqual([]);
    recordFailedSwap("fs-a.near", failed("call-1"), store);
    recordFailedSwap("fs-a.near", failed("call-2"), store);
    const list = listFailedSwaps("fs-a.near", store);
    expect(list.map((f) => f.callId)).toEqual(["call-2", "call-1"]);
    expect(list[0].entry.status).toBe("failed");
    expect(list[0].entry.amount_out).toBeNull();
  });

  it("recording the same call id twice is a no-op", () => {
    const store = fakeStore();
    recordFailedSwap("fs-b.near", failed("call-1"), store);
    recordFailedSwap("fs-b.near", failed("call-1"), store);
    expect(listFailedSwaps("fs-b.near", store)).toHaveLength(1);
  });

  it("keeps at most ten attempts per account, and accounts do not see each other", () => {
    const store = fakeStore();
    for (let i = 0; i < 12; i++) recordFailedSwap("fs-c.near", failed(`call-${i}`), store);
    const list = listFailedSwaps("fs-c.near", store);
    expect(list).toHaveLength(10);
    expect(list[0].callId).toBe("call-11");
    expect(listFailedSwaps("fs-d.near", store)).toEqual([]);
  });

  it("ignores malformed stored entries and clears on request", () => {
    const store = fakeStore();
    store.setItem("kh_failed_swaps_v1:fs-e.near", JSON.stringify([{ callId: "x" }, failed("call-1"), "junk"]));
    expect(listFailedSwaps("fs-e.near", store).map((f) => f.callId)).toEqual(["call-1"]);
    clearFailedSwaps("fs-e.near", store);
    expect(listFailedSwaps("fs-e.near", store)).toEqual([]);
  });
});
