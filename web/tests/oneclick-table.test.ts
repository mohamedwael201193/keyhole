import { describe, it, expect } from "vitest";
import { OC_ASSETS, DRY_ADDR, dryBody, toUnits, statusOf, isAddr } from "../lib/oneclick";

const [U, W, SU, SOL, BU, AU] = OC_ASSETS.map((a) => a.id);
const ok = { origin: SU, dest: U, amount: "50000" };

describe("1Click dry-quote tamper table: every altered field is refused, never forwarded", () => {
  it.each([
    ["origin not on the allowlist", { ...ok, origin: "nep141:evil.near" }],
    ["dest not on the allowlist", { ...ok, dest: "nep141:usdt.tether-token.near" }],
    ["origin with a trailing space", { ...ok, origin: SU + " " }],
    ["origin and dest the same asset", { ...ok, dest: SU }],
    ["negative amount", { ...ok, amount: "-5" }],
    ["decimal amount (must already be base units)", { ...ok, amount: "0.5" }],
    ["hex amount", { ...ok, amount: "0x10" }],
    ["amount in exponent form", { ...ok, amount: "1e6" }],
    ["empty amount", { ...ok, amount: "" }],
    ["amount over 30 digits", { ...ok, amount: "1".repeat(31) }],
  ])("%s", (_n, req) => expect(dryBody(req)).toBeNull());

  it("extra fields a caller smuggles in (dry:false, own recipient) are ignored", () => {
    const b = dryBody({ ...ok, dry: false, recipient: "attacker.near", refundTo: "attacker.near" } as never)!;
    expect(b.dry).toBe(true);
    expect(b.recipient).toBe(DRY_ADDR.near);
    expect(b.refundTo).toBe(DRY_ADDR.sol);
  });

  it("every supported ordered pair gets placeholders on the right chain and a 30-minute deadline", () => {
    const now = Date.UTC(2026, 10, 3);
    for (const o of OC_ASSETS) for (const d of OC_ASSETS) {
      const b = dryBody({ origin: o.id, dest: d.id, amount: "1" }, now);
      if (o.id === d.id) { expect(b).toBeNull(); continue; }
      expect(b!.refundTo).toBe(DRY_ADDR[o.chain]);
      expect(b!.recipient).toBe(DRY_ADDR[d.chain]);
      expect(Date.parse(b!.deadline as string) - now).toBe(30 * 60_000);
    }
  });

  it("placeholder addresses are valid for their own chain format", () => {
    expect(DRY_ADDR.near).toMatch(/\.near$/);
    for (const c of ["sol", "base", "arb"]) expect(isAddr(DRY_ADDR[c])).toBe(true);
  });
});

describe("toUnits table (decimal string to base units, no floats)", () => {
  it.each([
    ["0.05", 6, "50000"], ["1", 6, "1000000"], ["0.000001", 6, "1"], ["0.0000009", 6, null],
    ["1.23456789", 6, "1234567"], ["999999", 6, "999999000000"], ["0.1", 24, "1" + "0".repeat(23)],
    [" 2.5 ", 9, "2500000000"], ["0", 6, null], ["0.000", 6, null],
  ] as const)("%s @%i decimals -> %s", (v, d, want) => expect(toUnits(v, d)).toBe(want));

  it.each(["1000000", ".5", "5.", "1,5", "+1", "-1", "1e3", "NaN", "Infinity", "0x1"])("refuses %s", (v) => expect(toUnits(v, 6)).toBeNull());
});

describe("status tamper table: only the exact SUCCESS string reads as settled", () => {
  it.each(["success", "Success", " SUCCESS", "SUCCESS ", "SUCCEEDED", "OK", "", "__proto__", "toString"])("%j is not green", (s) => {
    expect(statusOf(s).tone).not.toBe("ok");
  });
  it.each(["toString", "__proto__", "constructor", "hasOwnProperty"])("prototype key %s falls back to a readable unknown state", (s) => {
    const st = statusOf(s);
    expect(st.tone).toBe("wait"); expect(st.label).toBe(s); expect(st.where).toBe("Status not recognised.");
  });
  it("null and undefined are waiting, not settled", () => { expect(statusOf(null).tone).toBe("wait"); expect(statusOf(undefined).tone).toBe("wait"); });
});
