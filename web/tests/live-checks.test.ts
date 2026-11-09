import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ATTACK_CASES } from "@/lib/liveChecks";
import { IDENTITY } from "@/lib/identity.gen";

const ev = (id: string) =>
  JSON.parse(readFileSync(new URL(`../public/evidence/${id}.json`, import.meta.url), "utf8")) as {
    call_id: string;
    output?: { error?: { code?: string }; ok?: boolean };
  };

describe("ATTACK_CASES evidence binding", () => {
  it("lists seven cases with live proof targets", () => {
    expect(ATTACK_CASES).toHaveLength(7);
    expect(ATTACK_CASES.filter((c) => c.kind === "attestation")).toHaveLength(6);
    expect(ATTACK_CASES.filter((c) => c.kind === "tx")).toHaveLength(1);
  });

  for (const c of ATTACK_CASES.filter((x) => x.kind === "attestation")) {
    it(`${c.id}: /evidence/${c.callId!.slice(0, 8)}…json error.code === ${c.keyword}`, () => {
      expect(existsSync(new URL(`../public/evidence/${c.callId}.json`, import.meta.url))).toBe(true);
      const j = ev(c.callId!);
      expect(j.call_id).toBe(c.callId);
      expect(j.output?.ok).toBe(false);
      expect(j.output?.error?.code).toBe(c.keyword);
    });
  }

  it("handover tx hash is the documented mainnet transfer", () => {
    const tx = ATTACK_CASES.find((c) => c.id === "handover-tx");
    expect(tx?.txHash).toBe("G35r5pmCTffvKMShjPcwTkds1z8SuCHdJr32qGGzYktD");
  });

  it("each attestation case names its recorded wasm and marks previous vs current", () => {
    const CUR = IDENTITY.worker.wasm_sha256.slice(0, 8);
    for (const c of ATTACK_CASES.filter((x) => x.kind === "attestation")) {
      expect(c.build, c.id).toBeTruthy();
      expect(c.build!.wasm.length).toBe(8);
      expect(c.build!.current).toBe(c.build!.wasm === CUR);
      // Today every refusal is a previous build; keep the field so current ones can flip current:true later.
      expect(c.build!.current, c.id).toBe(false);
    }
    expect(ATTACK_CASES.find((c) => c.id === "bad-recipient")!.build!.wasm).toBe("6367401a");
    expect(ATTACK_CASES.find((c) => c.id === "locked")!.build!.wasm).toBe("38bd67b9");
  });

});
