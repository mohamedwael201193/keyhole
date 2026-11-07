import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const src = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
const en = JSON.parse(src("../messages/en.json"));

describe("vault labels", () => {
  const v = src("../app/vault/view.tsx");
  it("says 'with your session' when the balance came through the session", () => {
    expect(en.vault.balanceSession).toBe("Read from the enclave with your session.");
    expect(v).toContain('=== "session" ? t("vault.balanceSession")');
    expect(src("../lib/useSigned.ts")).toContain('setVia(viaSession ? "session" : "signature")');
  });
  it("per-trade meter shows the cap, never a spend: trading and its quote preview moved to /swap", () => {
    expect(v).toContain('testid="per-trade-meter"');
    expect(v).toContain('t("vault.capOnly", { cap: fmtUsd(perCap) })');
    expect(v).not.toContain("swapParams");
    expect(v).not.toContain("quotePreview");
    expect(en.vault.quotePreview).toMatch(/^this quote /);
  });
  it("links the key's history and contract when no mint tx is stored", () => {
    expect(v).toContain('data-testid="vault-key-link"');
    expect(v).toContain("acct(KEYS_CONTRACT)");
  });
});
