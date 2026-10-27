import { describe, expect, it } from "vitest";
import { keyState, shortAccount, tierName } from "@/lib/near";
import { toBaseUnits } from "@/lib/assets";
import { WORKER_ERROR_CODES } from "@/lib/errors";
import { errorText, translate } from "@/lib/i18n";
import { staticChecks, CALL_ID, fastfsUrl } from "@/lib/verify";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import { readFileSync } from "node:fs";

const tok = (owner: string, exp: string | null = null) => ({ owner_id: owner, metadata: { title: null, description: null, issued_at: null, expires_at: exp } });
describe("key state from chain data", () => {
  it("legendary only for tier 3", () => expect(keyState(tok("a"), 3, "a")).toBe("legendary"));
  it("expired when expires_at passed", () => expect(keyState(tok("a", "100"), 1, "a", 200)).toBe("expired"));
  it("unlocked only for the holder", () => { expect(keyState(tok("a"), 1, "a")).toBe("unlocked"); expect(keyState(tok("a"), 1, "b")).toBe("locked"); expect(keyState(tok("a"), 1, null)).toBe("locked"); });
  it("tier names", () => expect([1, 2, 3, null].map(tierName)).toEqual(["Bronze", "Silver", "Gold", "—"]));
});
describe("formatting", () => {
  it("truncates 64-hex implicit accounts in the middle", () => expect(shortAccount("a".repeat(64))).toBe("aaaaaa…aaaaaa"));
  it("keeps named accounts", () => expect(shortAccount("alice.near")).toBe("alice.near"));
  it.each([["0.05", 6, "50000"], ["1", 6, "1000000"], ["1.2345678", 6, "1234567"], ["0", 6, null], ["abc", 6, null], ["-1", 6, null], ["1", 24, "1" + "0".repeat(24)]])("toBaseUnits(%s,%i)=%s", (v, d, r) => expect(toBaseUnits(v as string, d as number)).toBe(r));
});
describe("error catalog", () => {
  const src = readFileSync(__dirname + "/../../tee/worker/src/main.rs", "utf8") + readFileSync(__dirname + "/../../tee/worker/src/lib.rs", "utf8");
  const workerCodes = [...new Set([...src.matchAll(/err\("([a-z_]+)"/g)].map((m) => m[1]))];
  it("every worker error code has a plain message + fix in English and Arabic", () => {
    for (const c of [...workerCodes, ...WORKER_ERROR_CODES]) {
      expect((en.errors as Record<string, string[]>)[c], c).toHaveLength(2);
      expect((ar.errors as Record<string, string[]>)[c], "ar " + c).toHaveLength(2);
    }
  });
  it("Arabic covers every non-error key", () => {
    const keys = (o: object, p = ""): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && !Array.isArray(v) ? keys(v, p + k + ".") : [p + k]));
    const missing = keys(en).filter((k) => !k.startsWith("errors.") && translate("ar", k) === translate("en", k) && !/badge|cta2|s3/.test(k));
    expect(missing).toEqual([]);
    expect(Object.keys(ar).length).toBeGreaterThan(5);
  });
  it("interpolates vars", () => expect(errorText("en", "over_cap_per_tx", { cap: "$1.00" })[0]).toContain("$1.00"));
});
describe("verify", () => {
  const h = "a".repeat(64);
  it("passes when registered == executed and quote present", () => expect(staticChecks({ executed_wasm_sha256: h, wasm_hash: h, tdx_quote: "x".repeat(200) })).toEqual({ quote: true, registered: true }));
  it("fails on mismatch", () => expect(staticChecks({ executed_wasm_sha256: h, wasm_hash: "b".repeat(64), tdx_quote: "" })).toEqual({ quote: false, registered: false }));
  it("call id is a uuid", () => { expect(CALL_ID.test("e099f957-e3c6-4035-999a-907d9782997e")).toBe(true); expect(CALL_ID.test("../x")).toBe(false); });
  it("FastFS url", () => expect(fastfsUrl("keyhole-devmo.near/keyhole-probe", h)).toBe(`https://main.fastfs.io/keyhole-devmo.near/outlayer.near/${h}.wasm`));
});
