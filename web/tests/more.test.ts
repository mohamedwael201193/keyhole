import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pillAccount, shortKeyId } from "@/lib/near";
import { createLimiter } from "@/lib/ratelimit";
import { EVIDENCE_IDS } from "@/lib/evidenceIds";
import { CALLS } from "@/lib/evidence";
import { b64, pemCerts, verifyQuote, INTEL_ROOT_SHA256 } from "@/lib/dcap";
import { eventCanonical, holders, short, type KeyEvent } from "@/lib/keylog";
import { reportData } from "@/lib/ai";

const ev = (id: string) => JSON.parse(readFileSync(`${__dirname}/../public/evidence/${id}.json`, "utf8"));
const canon = (v: unknown): string => Array.isArray(v) ? `[${v.map(canon).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v);
const att = JSON.parse(readFileSync(`${__dirname}/fixtures/att_f4768da8.json`, "utf8"));
const AT = Date.UTC(2026, 10, 1);

describe("labels", () => {
  it("pill keeps short named accounts", () => expect(pillAccount("bob.near")).toBe("bob"));
  it("pill truncates long named accounts", () => expect(pillAccount("averyverylongname.near")).toBe("averyvery…"));
  it("pill shortens implicit and 0x accounts", () => { expect(pillAccount("a".repeat(64))).toBe("aaaa…aaaa"); expect(pillAccount("0x" + "b".repeat(40))).toBe("0xbbbb…bbbb"); });
  it("short key id", () => { expect(shortKeyId("k5f4750858f328940")).toBe("5f47"); expect(shortKeyId("kab12")).toBe("ab12"); });
  it("short() leaves short strings", () => { expect(short("bob.near")).toBe("bob.near"); expect(short("c".repeat(64))).toBe("cccccc…cccc"); });
});

describe("gateway rate limiter", () => {
  it("allows up to the limit in a window", () => { const l = createLimiter(2, 1000); expect(l("ip", 0).ok).toBe(true); expect(l("ip", 1).ok).toBe(true); expect(l("ip", 2)).toEqual({ ok: false, retryAfter: 1 }); });
  it("resets after the window", () => { const l = createLimiter(1, 1000); l("ip", 0); expect(l("ip", 500).ok).toBe(false); expect(l("ip", 1000).ok).toBe(true); });
  it("keys are independent", () => { const l = createLimiter(1, 1000); l("a", 0); expect(l("b", 0).ok).toBe(true); });
});

describe("published evidence", () => {
  it("every listed id has a file whose call_id matches", () => { for (const id of EVIDENCE_IDS) { expect(existsSync(`${__dirname}/../public/evidence/${id}.json`)).toBe(true); expect(ev(id).call_id).toBe(id); } });
  it("at least seven refusals have published outputs", () => expect(CALLS.filter((c) => c.outcome.startsWith("refused") && EVIDENCE_IDS.has(c.id)).length).toBeGreaterThanOrEqual(7));
  it("refusal outcomes match the published output", () => {
    for (const c of CALLS) if (c.outcome.startsWith("refused") && EVIDENCE_IDS.has(c.id)) expect(c.outcome).toContain(ev(c.id).output.error.code);
  });
  it("mid-payout: the paid withdraw is bound to the holder who signed it", () => {
    const o = ev("129161f9-2534-4a3f-9544-44f8da9dd7c2").output;
    expect(o.ok).toBe(true); expect(o.to).toBe(o.bind.account); expect(o.amount).toBe("3000");
  });
  it("mid-payout: the new holder sees exactly the remainder", () => {
    expect(ev("f36d9b54-417a-4b33-9598-c396ae852d4d").output.balances[0].balance).toBe("2000");
  });
  it("attack log: every attack path is refused except the delayed cap raise", () => {
    const codes = ["c1312e2d-8c20-4b3e-ad5b-22dd3102826d", "afaaf3e1-32ff-42d8-88da-412a0bb61e11", "d8f5f0ee-3c0b-44bc-afed-bc24ad190ed0", "16b09581-9010-4600-b5c5-58af0216cdc8", "711795b9-3e77-4a59-98ee-d798cb63ccc2"].map((id) => ev(id).output.error.code);
    expect(codes).toEqual(["bad_params", "over_cap_per_tx", "replay", "bad_signature", "not_owner"]);
    const raise = ev("06cf2630-aed4-410a-9e28-f0799efddeda").output.holder_limits;
    expect(raise.per_tx_usd_micro).toBe(2000); expect(raise.pending.per_tx_usd_micro).toBe(1000000);
  });
  it("canonical output hashing is key-order independent", () => {
    expect(createHash("sha256").update(canon({ b: 1, a: { d: [1, 2], c: "x" } })).digest("hex")).toBe(createHash("sha256").update(canon({ a: { c: "x", d: [1, 2] }, b: 1 })).digest("hex"));
  });
});

describe("dcap edge cases", () => {
  it("the quote carries three PEM certificates, the last is the pinned root", () => {
    const pem = Buffer.from(att.tdx_quote, "base64").toString("latin1").match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)!.join("\n");
    const cs = pemCerts(pem);
    expect(cs.map((c) => c.subject)).toEqual(["Intel SGX PCK Certificate", "Intel SGX PCK Platform CA", "Intel SGX Root CA"]);
    expect(createHash("sha256").update(cs[2].der).digest("hex")).toBe(INTEL_ROOT_SHA256);
  });
  it("rejects a non-v4 header", () => { const q = b64(att.tdx_quote); q[0] = 3; expect(verifyQuote(q, { now: AT }).checks.find((c) => c.id === "ver")!.pass).toBe(false); });
  it("rejects an SGX (non-TDX) TEE type", () => { const q = b64(att.tdx_quote); q[4] = 0; expect(verifyQuote(q, { now: AT }).checks.find((c) => c.id === "tee")!.pass).toBe(false); });
  it("flags a debug TD", () => { const q = b64(att.tdx_quote); q[48 + 120] |= 1; const r = verifyQuote(q, { now: AT }); expect(r.checks.find((c) => c.id === "debug")!.pass).toBe(false); expect(r.ok).toBe(false); });
  it("flags a foreign QE signer", () => { const q = b64(att.tdx_quote); q[636 + 134 + 128] ^= 1; expect(verifyQuote(q, { now: AT }).checks.find((c) => c.id === "qeSigner")!.pass).toBe(false); });
  it("exposes MRTD and four RTMRs", () => { const r = verifyQuote(b64(att.tdx_quote), { now: AT }); expect(r.mrtd).toMatch(/^[0-9a-f]{96}$/); expect(r.rtmr).toHaveLength(4); });
});

describe("key log format", () => {
  const e: KeyEvent = { i: 0, hash: "", kind: "deposit", owner: "a", prev: "0".repeat(64), ts_ms: 5, detail_hash: "d" };
  it("canonical bytes use the worker's fixed field order", () => expect(eventCanonical(e, "k1")).toBe(`{"detail_hash":"d","i":0,"kind":"deposit","owner":"a","prev":"${"0".repeat(64)}","token_id":"k1","ts_ms":5}`));
  it("no events, no holders", () => expect(holders([])).toEqual([]));
  it("counts trades and other events per holder", () => {
    const h = holders([e, { ...e, i: 1, kind: "swap" }, { ...e, i: 2, kind: "lock" }]);
    expect(h).toHaveLength(1); expect(h[0]).toMatchObject({ deposits: 1, trades: 1, other: 1, withdraws: 0 });
  });
});

describe("private AI", () => {
  it("reportData rejects a short quote", () => expect(reportData("00")).toBeNull());
});
