import { describe, it, expect } from "vitest";
import { clearWalletConnectionKeys, DISCONNECT_WALLET_KEYS } from "@/lib/wallet";
import { clearSession, SESSION_KEY } from "@/lib/session";
import { browserMoneyStore, dispatchMoney, type MoneyOperation } from "@/lib/pledgeMoney";
import { browserExitStore, type ExitRecord } from "@/lib/pledgeExit";
import type { IntentEnvironment } from "@/lib/pledgeIntentStore";

class MemoryStorage implements Storage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}
function tabs(storage: MemoryStorage) {
  let id = 0, queue = Promise.resolve();
  const locks = { request<T>(_key: string, fn: () => T | Promise<T>) { const run = queue.then(fn); queue = run.then(() => {}, () => {}); return run; } };
  const env = (): IntentEnvironment => ({ storage, session: new MemoryStorage(), locks, uuid: () => `id-${++id}`, listen: () => () => {}, changed: () => {} });
  return { env };
}

const call = { method: "claim_payout", args: {}, deposit: "1", gas: "200000000000000" };
const exit: ExitRecord = { account: "alice.near", token: "k1", epoch: "1", amount: "100000", status: "AwaitingSignature", intent: "exact_near_exit_v1" };

describe("disconnect keeps saved money operations", () => {
  it("a pending payout op and a saved exit survive the exact storage clearing disconnect performs", async () => {
    const storage = new MemoryStorage(), { env } = tabs(storage);
    // Seed the pending money operation the way the app does (persist before the wallet call),
    // plus a saved pledge exit — both are the records that stop a resend after an UNKNOWN.
    const money = browserMoneyStore("alice.near", "keys.near", env());
    await dispatchMoney("alice.near", "keys.near", call, money, async () => ({ txHash: "original" }), "42");
    const savedOp = money.load();
    expect(savedOp).toMatchObject({ status: "Submitted", txHash: "original" });
    const exits = browserExitStore("alice.near", "keys.near", "k1", env());
    const savedExit = await exits.reserve(exit);
    expect(exits.load()).toEqual(savedExit);
    // A legacy-shaped record (stored directly under the scope key, no :intent: suffix) for a
    // second account — the other key form a broad clear could wipe.
    const legacyOp: MoneyOperation = { account: "bob.near", contract: "keys.near", call, status: "UNKNOWN", txHash: "legacy-hash", minBlockHeight: "42" };
    storage.setItem("keyhole:pledge-money:v1:keys.near:bob.near", JSON.stringify(legacyOp));
    const legacy = browserMoneyStore("bob.near", "keys.near", env());
    // Seed the wallet + session keys disconnect is meant to forget.
    for (const key of DISCONNECT_WALLET_KEYS) storage.setItem(key, "1");
    storage.setItem(SESSION_KEY, JSON.stringify({ token: "t", account: "alice.near", token_id: "k1", exp_ms: 9_999_999_999_999, max_usd_micro: 5_000_000 }));
    // The disconnect storage footprint, in order: session forget (revokeStored) then the wallet keys (finally).
    clearSession(storage);
    clearWalletConnectionKeys(storage);
    // Wallet + session keys are gone…
    for (const key of DISCONNECT_WALLET_KEYS) expect(storage.getItem(key)).toBeNull();
    expect(storage.getItem(SESSION_KEY)).toBeNull();
    // …but the pending money operation and the saved exit are still there, loadable, unchanged —
    // in both key forms (reserved :intent: record and legacy scope-key record).
    expect(money.load()).toEqual(savedOp);
    expect(money.load()).toMatchObject({ status: "Submitted", txHash: "original" });
    expect(legacy.load()).toEqual(legacyOp);
    expect(exits.load()).toEqual(savedExit);
  });
  it("the disconnect allowlist is wallet-connection keys only — nothing a money op lives under", () => {
    expect([...DISCONNECT_WALLET_KEYS]).toEqual([
      "near-wallet-selector:selectedWalletId",
      "near-wallet-selector:recentlySignedInWallets",
      "selected-wallet",
      "kh_privy",
    ]);
    for (const key of DISCONNECT_WALLET_KEYS) {
      expect(key.startsWith("keyhole:pledge-")).toBe(false);
      expect(key.startsWith("keyhole:pledge-money")).toBe(false);
    }
  });
});
