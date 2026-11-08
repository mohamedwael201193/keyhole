import { describe, expect, it, vi } from "vitest";

// The store reads the wallet and the route; the pure freshness rule needs neither.
vi.mock("next/navigation", () => ({ usePathname: () => null }));
vi.mock("@/lib/wallet", () => ({ useWallet: () => ({ accountId: null }) }));

import { FRESH_MS, keyEntryFresh } from "@/lib/keyStore";

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
