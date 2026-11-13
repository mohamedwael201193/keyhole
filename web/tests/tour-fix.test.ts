import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { vaultCacheGetStale, vaultCacheSet, VAULT_CACHE_TTL_MS, clearVaultCache } from "@/lib/vaultCache";
import { isLocalFailedId, listFailedSwaps, localFailedId, recordFailedSwap, type FailedSwap } from "@/lib/failedSwaps";
import { formatUpdatedAgo } from "@/lib/vaultData";
import { CAP_NOTE, PAUSED_MESSAGE } from "@/components/swap/SwapProgress";
import type { WorkerResult } from "@/lib/worker";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

/** An in-memory stand-in for sessionStorage (vitest runs in node, where there is none). */
function fakeStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
  };
}

const res = (call_id: string): WorkerResult => ({ call_id, status: "ok", output: { ok: true }, attestation_url: null, time_ms: 1 });

describe("tour fix: stale-while-revalidate cache", () => {
  it("the TTL is 5 minutes and a stale entry is still served with its timestamp", () => {
    expect(VAULT_CACHE_TTL_MS).toBe(300_000);
    const store = fakeStore();
    clearVaultCache(store);
    const key = "kh_vault_v1:alice.near:tok-1:balance";
    vaultCacheSet(key, res("c1"), store);
    // Age the stored entry past the TTL by rewriting its timestamp.
    const raw = JSON.parse(store.getItem(key)!);
    raw.at = Date.now() - VAULT_CACHE_TTL_MS - 1_000;
    store.setItem(key, JSON.stringify(raw));
    clearVaultCache(null);
    const stale = vaultCacheGetStale(key, store);
    expect(stale).not.toBeNull();
    expect(stale!.entry.call_id).toBe("c1");
    expect(stale!.at).toBe(raw.at);
    expect(vaultCacheGetStale("kh_vault_v1:alice.near:tok-1:missing", store)).toBeNull();
    expect(vaultCacheGetStale(null, store)).toBeNull();
  });

  it("formatUpdatedAgo labels the last read", () => {
    expect(formatUpdatedAgo(null)).toBeNull();
    expect(formatUpdatedAgo(undefined)).toBeNull();
    const now = 1_000_000_000_000;
    expect(formatUpdatedAgo(now, now)).toBe("Updated just now");
    expect(formatUpdatedAgo(now - 30_000, now)).toBe("Updated 30s ago");
    expect(formatUpdatedAgo(now - 5 * 60_000, now)).toBe("Updated 5m ago");
    expect(formatUpdatedAgo(now - 2 * 60 * 60_000, now)).toBe("Updated 2h ago");
  });
});

describe("tour fix: a failed swap with no call id is still recorded", () => {
  it("a local id is recognisable and records like a real call id", () => {
    const id = localFailedId(1_700_000_000_000);
    expect(id.startsWith("local:")).toBe(true);
    expect(isLocalFailedId(id)).toBe(true);
    expect(isLocalFailedId("call-1")).toBe(false);
    expect(isLocalFailedId(null)).toBe(false);
    const store = fakeStore();
    const f: FailedSwap = {
      callId: id,
      local: true,
      entry: { kind: "swap", status: "failed", ts_ms: 1_000, token_in: "usdc", token_out: "wnear", amount_in: "10000", amount_out: null },
      code: "network",
    };
    expect(listFailedSwaps("fs-b.near", store)).toEqual([]);
    recordFailedSwap("fs-b.near", f, store);
    const list = listFailedSwaps("fs-b.near", store);
    expect(list).toHaveLength(1);
    expect(list[0].callId).toBe(id);
    expect(list[0].local).toBe(true);
  });
});

describe("tour fix: swap failure copy is plain and honest", () => {
  it("the paused message and the cap note use plain words", () => {
    expect(PAUSED_MESSAGE).toBe("Swaps are paused while an earlier transaction confirms. Nothing was sent.");
    expect(CAP_NOTE).toBe("A failed attempt may hold part of today's limit until 00:00 UTC. Check the Today meter on the Vault page.");
    expect(PAUSED_MESSAGE).not.toMatch(/native|reconcile|network error/i);
    expect(CAP_NOTE).not.toMatch(/can still count/);
  });

  it("the failure screen shows the no-broadcast line for a network error", () => {
    const s = src("../components/swap/SwapProgress.tsx");
    expect(s).toContain("No transaction was broadcast — nothing moved.");
    expect(s).toContain("PAUSED_MESSAGE");
  });

  it("the vault cap copy says 'may hold', not 'can still count'", () => {
    const m = JSON.parse(src("../messages/en.json"));
    expect(m.vault.capRefused).toContain("may hold part of today's limit until 00:00 UTC");
  });
});

describe("tour fix: copy counts are 36, not 37", () => {
  it("no shipped copy says 37 checks or six attestation checks", () => {
    for (const p of ["../messages/en.json", "../app/developers/view.tsx", "../app/verify/path/page.tsx", "../app/verify/view.tsx"]) {
      const t = src(p);
      expect(t).not.toContain("37 checks");
      expect(t).not.toContain("Six attestation checks");
    }
    const m = JSON.parse(src("../messages/en.json"));
    expect(m.verify.lead).toContain("Five attestation checks");
    expect(m.verify.tallyWait).toContain("36 checks");
  });
});

describe("tour fix: layout, entry points and per-tab copy", () => {
  it("the public kp-root pages get the same page inset as the app shell (no flush left edge)", () => {
    const css = src("../components/keys/keys.css");
    expect(css).toContain(".kp-root { padding: var(--space-4) var(--space-5) var(--space-5); }");
  });

  it("the source download button keeps its own foreground (the card-link teal does not override it)", () => {
    const css = src("../app/public-pages.css");
    expect(css).toContain(".pp-source .pp-card a:not(.kh-btn)");
    expect(css).not.toContain(".pp-source .pp-card a { color: var(--teal)");
  });

  it("the Keys page always shows Mint, even when the account already holds a key", () => {
    const v = src("../app/gallery/view.tsx");
    expect(v).toContain('testid="keys-mint">Mint a key</Button>');
    // Mint is not hidden behind the has-a-key branch any more.
    expect(v).not.toContain('store.keys.length > 0 ? <Button href={dashHref(`/key?');
  });

  it("the deposit sheet shows the Direct lead only on the Direct tab", () => {
    const v = src("../app/vault/view.tsx");
    expect(v).toContain('{depTab === "direct" && <p className="vlt-sub">{t("vault.fundLead")}</p>}');
  });

  it("the sidebar Mint link is shown for any signed-in account, not only keyless ones", () => {
    const s = src("../components/app/AppShell.tsx");
    expect(s).toContain("const mint = !!accountId;");
    expect(s).not.toContain("keys.keys.length === 0");
  });
});

describe("tour fix: session sharing across tabs", () => {
  it("the session store is localStorage (shared across tabs) with a BroadcastChannel", () => {
    const s = src("../lib/session.ts");
    expect(s).toContain('export const SESSION_KEY = "kh_session_v1"');
    expect(s).toContain("localStorage");
    expect(s).toContain('CHANNEL_NAME = "keyhole-session-v1"');
    expect(s).toContain("onSessionBroadcast");
    expect(s).toContain('broadcast("saved")');
    expect(s).toContain('broadcast("cleared")');
  });
});
