import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ATTACK_CASES } from "@/lib/liveChecks";

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
});
