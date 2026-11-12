import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isAmountString, isNullableString, isOneOf, isString, readSessionValue, removeSessionValue, writeSessionValue } from "@/lib/useSessionState";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const throwing = () => ({
  getItem: (_k: string): string | null => { throw new Error("blocked"); },
  setItem: (_k: string, _v: string): void => { throw new Error("blocked"); },
  removeItem: (_k: string): void => { throw new Error("blocked"); },
});

describe("session state storage", () => {
  it("a value written is read back, and an absent key reads null", () => {
    const s = memory();
    expect(readSessionValue("k", isString, s)).toBeNull();
    writeSessionValue("k", "0.42", s);
    expect(readSessionValue("k", isString, s)).toBe("0.42");
    removeSessionValue("k", s);
    expect(readSessionValue("k", isString, s)).toBeNull();
  });

  it("corrupt JSON and a value failing validation read as null, never throw", () => {
    const s = memory();
    s.setItem("bad", "{not json");
    expect(readSessionValue("bad", isString, s)).toBeNull();
    writeSessionValue("n", 42, s);
    expect(readSessionValue("n", isString, s)).toBeNull();
    writeSessionValue("n", "settled", s);
    expect(readSessionValue("n", isOneOf(["all", "failed"] as const), s)).toBeNull();
    expect(readSessionValue("n", isOneOf(["all", "settled"] as const), s)).toBe("settled");
  });

  it("a blocked store never throws on read, write or remove", () => {
    const s = throwing();
    expect(() => readSessionValue("k", isString, s)).not.toThrow();
    expect(readSessionValue("k", isString, s)).toBeNull();
    expect(() => writeSessionValue("k", "v", s)).not.toThrow();
    expect(() => removeSessionValue("k", s)).not.toThrow();
  });

  it("a null store (no window, server render) reads null and writes nothing", () => {
    expect(readSessionValue("k", isString, null)).toBeNull();
    expect(() => writeSessionValue("k", "v", null)).not.toThrow();
    expect(() => removeSessionValue("k", null)).not.toThrow();
  });

  it("amounts accept what the field accepts and reject the rest", () => {
    for (const v of ["0.05", "0.42", "1", "", "12.", "0.000001"]) expect(isAmountString(v), v).toBe(true);
    for (const v of ["abc", "1e5", "0.05.1", "-1", "1,000", "x".repeat(21), 42, null]) expect(isAmountString(v), String(v)).toBe(false);
    expect(isNullableString(null)).toBe(true);
    expect(isNullableString("abc")).toBe(true);
    expect(isNullableString(42)).toBe(false);
  });
});

describe("dashboard form state survives a section switch", () => {
  it("the swap keeps its pair and amount in session storage, never a quote or a result", () => {
    const s = src("../app/swap/view.tsx");
    expect(s).toContain('useSessionState("kh.swap.amount", "0.05", isAmountString)');
    expect(s).toContain('useSessionState("kh.swap.from"');
    expect(s).toContain('useSessionState("kh.swap.to"');
    expect(s).not.toContain('useState("0.05")');
    expect(s).not.toContain("useState<Token>(FALLBACK");
    expect(s).not.toContain("kh.swap.quoted");
    expect(s).not.toContain("kh.swap.done");
  });

  it("the vault keeps its fund and withdraw amounts, asset and tab", () => {
    const s = src("../app/vault/view.tsx");
    for (const k of ["kh.vault.fundAmt", "kh.vault.wAmt", "kh.vault.fundAsset", "kh.vault.wAsset", "kh.vault.depTab"]) expect(s).toContain(k);
    expect(s).not.toContain("kh.vault.doneWithdraw");
  });

  it("activity keeps its source, filter, range and search; keys keep filter, search and selection", () => {
    const s = src("../app/settle/view.tsx");
    for (const k of ["kh.activity.source", "kh.activity.filter", "kh.activity.range", "kh.activity.query"]) expect(s).toContain(k);
    const g = src("../app/gallery/view.tsx");
    expect(g).toContain("kh.gallery.${initial}.filter");
    expect(g).toContain("kh.gallery.${initial}.query");
    expect(g).toContain("kh.gallery.${initial}.picked");
  });

  it("the /try mainnet toggle goes to the dashboard, not the landing page", () => {
    expect(src("../app/try/view.tsx")).toContain('<Link href="/dashboard" data-testid="net-mainnet">');
  });
});
