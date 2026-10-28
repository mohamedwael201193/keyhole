import { describe, expect, it } from "vitest";
import { keyState, shortAccount, tierName } from "@/lib/near";
import { CAPS, bitCipherBits, finishOf, foilHue, keyIdentity, nep177, serialOf, traitSeed, toHex } from "@/lib/traits";
import { toBaseUnits } from "@/lib/assets";
import { WORKER_ERROR_CODES } from "@/lib/errors";
import { errorText, translate } from "@/lib/i18n";
import { staticChecks, CALL_ID, fastfsUrl, PUBLISHED_WASM_SHA256, publishedBuild } from "@/lib/verify";
import en from "@/messages/en.json";
import { readFileSync } from "node:fs";

const tok = (owner: string, exp: string | null = null) => ({ owner_id: owner, metadata: { title: null, description: null, issued_at: null, expires_at: exp } });
describe("key state from chain data", () => {
  it("legendary only for tier 3", () => expect(keyState(tok("a"), 3, "a")).toBe("legendary"));
  it("expired when expires_at passed", () => expect(keyState(tok("a", "100"), 1, "a", 200)).toBe("expired"));
  it("unlocked only for the holder", () => { expect(keyState(tok("a"), 1, "a")).toBe("unlocked"); expect(keyState(tok("a"), 1, "b")).toBe("locked"); expect(keyState(tok("a"), 1, null)).toBe("locked"); });
  it("tier names", () => expect([1, 2, 3, null].map(tierName)).toEqual(["Bronze", "Silver", "Gold", "—"]));
});
describe("key traits", () => {
  it("seeds sha256(contract_id + token_id)", () => {
    expect(toHex(traitSeed("keyhole-devmo.near", "1"))).toBe("d3d69e48c9d76f66473f833611c0db336cf6d66fe5f0e97010db53792bf9ea1e");
  });
  it("draws the token id in binary", () => {
    expect(bitCipherBits("1")).toBe("00000001");
    expect(bitCipherBits("10")).toBe("00001010");
    expect(bitCipherBits("k857b6b68facc0f94")).toBe("10010100");
  });
  it("keeps same-art keys apart by cipher and serial", () => {
    const a = keyIdentity("0", 1);
    const b = keyIdentity("k0642e7964b2fb515", 1);
    expect(a.art).toBe(b.art);
    expect(a.bits).not.toBe(b.bits);
    expect(serialOf(a.seedHex)).not.toBe(serialOf(b.seedHex));
    expect(foilHue(a.seedHex)).not.toBe(foilHue(b.seedHex));
    expect(Math.abs(foilHue(a.seedHex))).toBeLessThanOrEqual(12);
    const c = keyIdentity("k5f4750858f328940", 1);
    const d = keyIdentity("k857b6b68facc0f94", 1);
    expect(c.art).toBe(d.art);
    expect(c.bits).not.toBe(d.bits);
  });
  it("is deterministic and stays inside the finish", () => {
    const a = keyIdentity("k857b6b68facc0f94", 1);
    expect(keyIdentity("k857b6b68facc0f94", 1)).toEqual(a);
    expect(["Bronze"]).toContain(a.finish);
    expect([3, 5, 8]).toContain(a.art);
    expect(a.perTx).toBe(1);
    expect(a.daily).toBe(5);
  });
  it("legendary is a rare Gold-cap finish, not a new limit", () => {
    const rare = new Uint8Array(32); rare[1] = 0;
    const plain = new Uint8Array(32); plain[1] = 1;
    expect(finishOf(3, rare)).toBe("Legendary");
    expect(finishOf(3, plain)).toBe("Gold");
    expect(finishOf(1, rare)).toBe("Bronze");
    expect(CAPS.Legendary).toEqual(CAPS.Gold);
    const leg = keyIdentity("1", 3, "rare-contract");
    expect(leg.perTx).toBe(100);
    expect(leg.daily).toBe(500);
    expect(nep177("1", 1).extra.traits.bit_cipher).toBe("00000001");
    expect(nep177("1", 1).extra.seed).toBe("sha256(contract ‖ token_id)");
  });
});
describe("formatting", () => {
  it("truncates 64-hex implicit accounts in the middle", () => expect(shortAccount("a".repeat(64))).toBe("aaaaaa…aaaaaa"));
  it("keeps named accounts", () => expect(shortAccount("alice.near")).toBe("alice.near"));
  it.each([["0.05", 6, "50000"], ["1", 6, "1000000"], ["1.2345678", 6, "1234567"], ["0", 6, null], ["abc", 6, null], ["-1", 6, null], ["1", 24, "1" + "0".repeat(24)]])("toBaseUnits(%s,%i)=%s", (v, d, r) => expect(toBaseUnits(v as string, d as number)).toBe(r));
});
describe("error catalog", () => {
  const src = readFileSync(__dirname + "/../../tee/worker/src/main.rs", "utf8") + readFileSync(__dirname + "/../../tee/worker/src/lib.rs", "utf8");
  const workerCodes = [...new Set([...src.matchAll(/err\("([a-z_]+)"/g)].map((m) => m[1]))];
  it("every worker error code has a plain English message and a fix", () => {
    for (const c of [...workerCodes, ...WORKER_ERROR_CODES]) {
      expect((en.errors as Record<string, string[]>)[c], c).toHaveLength(2);
    }
  });
  it("resolves catalog keys", () => expect(translate("nav.home")).toBe("Home"));
  it("interpolates vars", () => expect(errorText("over_cap_per_tx", { cap: "$1.00" })[0]).toContain("$1.00"));
});
describe("verify", () => {
  const h = "a".repeat(64);
  it("passes when registered == executed and quote present", () => expect(staticChecks({ executed_wasm_sha256: PUBLISHED_WASM_SHA256, wasm_hash: PUBLISHED_WASM_SHA256, tdx_quote: "x".repeat(200) })).toEqual({ quote: true, registered: true, published: true }));
  it("fails on mismatch and on a hash that is not the published build", () => {
    expect(staticChecks({ executed_wasm_sha256: h, wasm_hash: "b".repeat(64), tdx_quote: "" })).toEqual({ quote: false, registered: false, published: false });
    expect(publishedBuild(h)).toBe(false);
    expect(publishedBuild(PUBLISHED_WASM_SHA256)).toBe(true);
    expect(PUBLISHED_WASM_SHA256.startsWith("f13efe92")).toBe(true);
  });
  it("call id is a uuid", () => { expect(CALL_ID.test("e099f957-e3c6-4035-999a-907d9782997e")).toBe(true); expect(CALL_ID.test("../x")).toBe(false); });
  it("FastFS url", () => expect(fastfsUrl("keyhole-devmo.near/keyhole-probe", h)).toBe(`https://main.fastfs.io/keyhole-devmo.near/outlayer.near/${h}.wasm`));
});
