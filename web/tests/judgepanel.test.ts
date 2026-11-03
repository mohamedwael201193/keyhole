import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { EVIDENCE_IDS } from "@/lib/evidenceIds";
import { CALLS, PUBLISHED_INFO_CALL } from "@/lib/evidence";
import { SETTLEMENTS, VAULT_TRADE } from "@/lib/settlements";
import { canonical } from "@/lib/verify";
import enJson from "../messages/en.json";

const en = enJson as unknown as Record<string, Record<string, string>>;

const ev = (id: string) => JSON.parse(readFileSync(`${__dirname}/../public/evidence/${id}.json`, "utf8"));
const sha = (o: unknown) => createHash("sha256").update(canonical(o)).digest("hex");
// output_hash as served by https://api.outlayer.ai/attestations/by-call/<id> (fetched 2026-11-03).
const ATTESTED = {
  [PUBLISHED_INFO_CALL]: "396af1839efae3583b4025ae243f11fdbfc6df2d6fef9a756ce1f7e6794236f8",
  "0cd1c3bd-21be-44dc-bc60-e792a42344e6": "d34549aa0a2d6862d83ef5eb72e83ebc3464fdfa44705a72071ced3aedae2d15",
} as const;

describe("flagship outputs are published, so the sixth check is a real hash match", () => {
  it("the default /verify call has a published output", () => expect(EVIDENCE_IDS.has(PUBLISHED_INFO_CALL)).toBe(true));
  for (const [id, h] of Object.entries(ATTESTED)) {
    it(`${id.slice(0, 8)}: published output hashes to the attested output_hash`, () => expect(sha(ev(id).output)).toBe(h));
    it(`${id.slice(0, 8)}: one changed field no longer matches`, () => { const o = structuredClone(ev(id).output); o.ok = !o.ok; expect(sha(o)).not.toBe(h); });
  }
  it("the info output names the 20 ops of build 09d481a5, Chain Signatures and the beat key included", () => {
    const o = ev(PUBLISHED_INFO_CALL).output;
    expect(o.op).toBe("info"); expect(o.ops).toHaveLength(20);
    for (const op of ["chain_address", "chain_sign", "add_beat_key", "del_beat_key"]) expect(o.ops).toContain(op);
  });
  it("the chain_sign output returns the key's EVM address and is listed on /verify", () => {
    const o = ev("0cd1c3bd-21be-44dc-bc60-e792a42344e6").output;
    expect(o.ok).toBe(true); expect(o.evm_address).toBe("0xe39C947d5AAC2F9560b690E6f9a8B5d349f4f063"); expect(o.bind.token_id).toBe("k5f4750858f328940");
    expect(CALLS.some((c) => c.id === "0cd1c3bd-21be-44dc-bc60-e792a42344e6")).toBe(true);
  });
});

describe("settle page data stays true", () => {
  it("the vault trade card matches its published, attested output", () => {
    expect(EVIDENCE_IDS.has(VAULT_TRADE.callId)).toBe(true);
    const o = ev(VAULT_TRADE.callId).output;
    expect(o.ok).toBe(true); expect(o.op).toBe("swap"); expect(o.intent_hash).toBe(VAULT_TRADE.intentHash); expect(o.account).toBe(VAULT_TRADE.account);
    expect(Number(o.amount_out) / 1e24).toBeCloseTo(0.001077, 6); expect(o.usd_in_micro).toBe(5000);
  });
  it("no settlement text promises a future refund (live status carries the outcome)", () => {
    for (const s of SETTLEMENTS) expect(`${s.quote} ${s.note ?? ""}`).not.toMatch(/due at the deadline|will be refunded/i);
  });
});

describe("copy matches the product", () => {
  const land = en.land;
  const mint = en.mint;
  it("home does not promise eight vault assets", () => { expect(land.chainH).not.toMatch(/eight assets/i); expect(land.chainLead).toMatch(/USDC and wNEAR/); });
  it("home gallery is labelled as concept art, not minted tokens", () => expect(land.concept).toMatch(/not minted tokens/));
  it("mint says Bronze is what minting issues today and Legendary is not a fourth cap", () => { expect(mint.bronzeOnly).toMatch(/today issues a Bronze key/); expect(land.tierLead).toMatch(/not a fourth cap/); });
  it("verify explains worker_measurement is not the wasm hash", () => expect(en.verify.hashesNote).toMatch(/RTMR3/));
});

describe("worker_measurement is RTMR3 of the quote, not the wasm hash", async () => {
  const { b64, verifyQuote } = await import("@/lib/dcap");
  const a = JSON.parse(readFileSync(`${__dirname}/fixtures/att_f4768da8.json`, "utf8"));
  const d = verifyQuote(b64(a.tdx_quote));
  it("equals the RTMR3 register inside the quote", () => expect(d.rtmr[3]).toBe(a.worker_measurement.toLowerCase()));
  it("differs from the MRTD and from executed_wasm_sha256", () => { expect(d.mrtd).not.toBe(a.worker_measurement); expect(a.worker_measurement).not.toBe(a.executed_wasm_sha256); });
});
