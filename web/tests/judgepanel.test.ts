import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { EVIDENCE_IDS } from "@/lib/evidenceIds";
import { CALLS, PUBLISHED_INFO_CALL } from "@/lib/evidence";
import { SETTLEMENTS, VAULT_TRADE } from "@/lib/settlements";
import { fallbackTokens } from "@/lib/tokens";
import { IDENTITY } from "@/lib/identity.gen";
import { canonical } from "@/lib/verify";
import enJson from "../messages/en.json";

const en = enJson as unknown as Record<string, Record<string, string>>;
/** The live v2 landing strings (nested objects, so they need their own shape — the flat Record cast above types every leaf as a string). */
const liveLanding = enJson as unknown as { landing2: { v2: { hero: { body: string }; keys: { preview: string; mintable: string } } } };

const ev = (id: string) => JSON.parse(readFileSync(`${__dirname}/../public/evidence/${id}.json`, "utf8"));
const sha = (o: unknown) => createHash("sha256").update(canonical(o)).digest("hex");
// Public attestation pins: legacy proofs retained; current v2.6 fetched 2026-11-12.
const ATTESTED = {
  [PUBLISHED_INFO_CALL]: "5db6772a6db9a3799b982d962dc189cd650537a81d516a049c083518e9d2f8eb",
  "116641a2-0744-45a0-9698-4b23dab365fc": "b097b6ad0f3f7fa28564f3eb396afe2969ef16049b3c95449940d65ad6b4b8e4",
  "42f2c909-27db-4562-9a24-a0399c0f9a1d": "515b44fa7318864651938dd36e6e0ccf09d9a0012585ae6b91e414e0ef6a257e",
  "962d4374-b9ec-411a-9efa-973b36260431": "e7fb60372ffdda802b9d5326864fb2b9a8decefe9bad670c72566b9ae3c864f3",
  "dc3668db-674f-4865-a2ce-272f70c41b0d": "f1279fd09eafe0f9fe264ba32064a211e70100501eadf9bd3c05435e3ba161e8",
  "5650a6b7-b7de-410c-b206-e189171bad15": "d81005b5926c748bbd6ee8c7b5110bbb0dfff12696f7bfb905d4198f35036d91",
  "ecb0d1d6-90e3-4522-852a-578ca50fdeb6": "9a9a2712656ffa2bd4c4aae870fd42d2c80dd01a822b85f920480f7edc94af00",
  "b0a6eadb-cee9-400e-8eca-8b0f4df7bcec": "396af1839efae3583b4025ae243f11fdbfc6df2d6fef9a756ce1f7e6794236f8",
  "0cd1c3bd-21be-44dc-bc60-e792a42344e6": "d34549aa0a2d6862d83ef5eb72e83ebc3464fdfa44705a72071ced3aedae2d15",
} as const;

describe("flagship outputs are published, so the sixth check is a real hash match", () => {
  it("current default proof is pinned to the measured project and current build", () => {
    const a = JSON.parse(readFileSync(`${__dirname}/fixtures/att_${PUBLISHED_INFO_CALL.slice(0, 8)}.json`, "utf8"));
    expect(a.call_id).toBe(PUBLISHED_INFO_CALL);
    expect(a.project_id).toBe(IDENTITY.worker.project);
    expect(a.wasm_hash).toBe(IDENTITY.worker.wasm_sha256);
    expect(a.executed_wasm_sha256).toBe(IDENTITY.worker.wasm_sha256);
    expect(sha(ev(PUBLISHED_INFO_CALL).output)).toBe(a.output_hash);
  });
  it("the default /verify call has a published output", () => expect(EVIDENCE_IDS.has(PUBLISHED_INFO_CALL)).toBe(true));
  for (const [id, h] of Object.entries(ATTESTED)) {
    it(`${id.slice(0, 8)}: published output hashes to the attested output_hash`, () => expect(sha(ev(id).output)).toBe(h));
    it(`${id.slice(0, 8)}: one changed field no longer matches`, () => { const o = structuredClone(ev(id).output); o.ok = !o.ok; expect(sha(o)).not.toBe(h); });
  }
  it("the current guarded v2.6 info output names all 44 ops, including custody reconciliation and read-only exit preview", () => {
    const o = ev(PUBLISHED_INFO_CALL).output;
    expect(o.op).toBe("info"); expect(o.ops).toHaveLength(44);
    for (const op of ["chain_address", "chain_sign", "add_beat_key", "del_beat_key", "session", "session_revoke", "level_up", "withdraw_dry_run", "reconcile_value_op", "prepare_collateral", "pledge_inventory", "rebroadcast_minter_send"]) expect(o.ops).toContain(op);
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
  const mint = en.mint;
  it("home does not promise eight vault assets", () => { expect(JSON.stringify(liveLanding.landing2.v2)).not.toMatch(/eight assets/i); expect(liveLanding.landing2.v2.hero.body).not.toMatch(/eight assets/i); });
  it("the vault names its two supported assets, USDC and wNEAR", () => {
    // The landing no longer lists assets (L-2 dropped the list), so the claim lives where the vault states it:
    // the fallback token list the trade runs on, and the vault's own line pointing at the Swap page.
    expect(fallbackTokens().map((t) => t.symbol)).toEqual(["USDC", "wNEAR"]);
    const vault = readFileSync(`${__dirname}/../app/vault/view.tsx`, "utf8");
    expect(vault).toMatch(/Trade USDC and wNEAR from this vault/);
  });
  it("home gallery labels Bronze Mintable and Silver, Gold and Legendary Preview", () => {
    expect(liveLanding.landing2.v2.keys.preview).toMatch(/preview/i);
    expect(liveLanding.landing2.v2.keys.mintable).toMatch(/mintable/i);
    // Label existence alone would pass a mislabelled gallery: assert the per-finish wiring in the fan itself.
    const fan = readFileSync(`${__dirname}/../components/landing/KeysFan.tsx`, "utf8");
    expect(fan).toContain('{ finish: "Bronze", art: 3, rot: -8, mintable: true }');
    expect(fan).toContain('{ finish: "Silver", art: 4, rot: -3, mintable: false }');
    expect(fan).toContain('{ finish: "Gold", art: 2, rot: 3, mintable: false }');
    expect(fan).toContain('{ finish: "Legendary", art: 1, rot: 8, mintable: false }');
    expect(fan).toContain('c.mintable ? t("landing2.v2.keys.mintable") : t("landing2.v2.keys.preview")');
  });
  it("verify explains worker_measurement is not the wasm hash", () => expect(en.verify.hashesNote).toMatch(/RTMR3/));
});

describe("worker_measurement is RTMR3 of the quote, not the wasm hash", async () => {
  const { b64, verifyQuote } = await import("@/lib/dcap");
  const a = JSON.parse(readFileSync(`${__dirname}/fixtures/att_f4768da8.json`, "utf8"));
  const d = verifyQuote(b64(a.tdx_quote));
  it("equals the RTMR3 register inside the quote", () => expect(d.rtmr[3]).toBe(a.worker_measurement.toLowerCase()));
  it("differs from the MRTD and from executed_wasm_sha256", () => { expect(d.mrtd).not.toBe(a.worker_measurement); expect(a.worker_measurement).not.toBe(a.executed_wasm_sha256); });
});
