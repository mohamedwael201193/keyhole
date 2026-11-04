import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isTxHash, loadMintTx, saveMintTx } from "@/lib/mintTx";

const mem = new Map<string, string>();
beforeEach(() => { mem.clear(); (globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 } as Storage; });
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("live-walk UX fixes", () => {
  it("mint tx is kept per account and only real base58 tx hashes", () => {
    const h = "8ZbB5Mfo7iRxvmyb7xKkkx4ydMuW3PntdKFzA9uXQ2qT";
    expect(isTxHash(h)).toBe(true);
    saveMintTx("a.near", h); saveMintTx("a.near", "<script>");
    expect(loadMintTx("a.near")).toBe(h);
    expect(loadMintTx("b.near")).toBeNull();
  });
  it("Privy users see 'Signing securely…' while unlocking", () => {
    expect(src("../components/SessionCard.tsx")).toContain('via === "privy" ? "Signing securely…" : "Confirm in your wallet…"');
  });
  it("/start shows the mint tx link and a brief Unlocked confirmation", () => {
    const s = src("../app/start/view.tsx");
    expect(s).toContain('data-testid="start-mint-tx"');
    expect(s).toContain('data-testid="start-unlocked"');
  });
  it("/vault with a live session reads caps through the session dashboard, not 'Sign once'", () => {
    const v = src("../app/vault/view.tsx");
    expect(v).toContain('data-testid="limits-reading"');
    expect(v).toContain("Refresh balance (session, no popup)");
    expect(v).toContain('data-testid="vault-mint-tx"');
  });
});
