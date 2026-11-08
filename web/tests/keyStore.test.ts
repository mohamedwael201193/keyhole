import { describe, expect, it, vi } from "vitest";

// The store reads the wallet and the route; the pure freshness rule needs neither.
vi.mock("next/navigation", () => ({ usePathname: () => null }));
vi.mock("@/lib/wallet", () => ({ useWallet: () => ({ accountId: null }) }));

import { FRESH_MS, heldFrom, keyEntryFresh } from "@/lib/keyStore";

describe("key store freshness", () => {
  const now = 1_000_000;

  it("a read inside the fresh window is shown without a new RPC call", () => {
    expect(keyEntryFresh({ at: now - 1_000 }, now)).toBe(true);
    expect(keyEntryFresh({ at: now - (FRESH_MS - 1) }, now)).toBe(true);
  });

  it("an older read is shown at once but revalidated in the background", () => {
    expect(keyEntryFresh({ at: now - FRESH_MS }, now)).toBe(false);
    expect(keyEntryFresh({ at: now - 60_000 }, now)).toBe(false);
  });

  it("no cached read means a read now, and a forced refresh always reads", () => {
    expect(keyEntryFresh(null, now)).toBe(false);
    expect(keyEntryFresh({ at: now }, now, true)).toBe(false);
  });
});

describe("the holder's key, read from the shared store", () => {
  const token = { token_id: "4", owner_id: "holder.near" } as never;
  it("a cached key resolves at once: no looking up, the first key and its tier", () => {
    const h = heldFrom({ status: "ready", primary: token, tier: 1 }, "holder.near");
    expect(h.lookingUp).toBe(false);
    expect(h.keyMiss).toBe(false);
    expect(h.failed).toBe(false);
    expect(h.held).toEqual({ token, tier: 1 });
  });
  it("the first read of an account is the only time it is looking up", () => {
    expect(heldFrom({ status: "loading", primary: null, tier: null }, "holder.near").lookingUp).toBe(true);
    expect(heldFrom({ status: "idle", primary: null, tier: null }, "holder.near").lookingUp).toBe(true);
    expect(heldFrom({ status: "loading", primary: null, tier: null }, null).lookingUp).toBe(false);
  });
  it("a settled read with no key is a miss; a failed read with no key is neither a miss nor a key", () => {
    expect(heldFrom({ status: "ready", primary: null, tier: null }, "holder.near").keyMiss).toBe(true);
    const failed = heldFrom({ status: "error", primary: null, tier: null }, "holder.near");
    expect(failed.failed).toBe(true);
    expect(failed.keyMiss).toBe(false);
    expect(failed.held).toBeNull();
  });
});
