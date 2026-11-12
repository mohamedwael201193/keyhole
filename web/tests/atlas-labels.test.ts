import { describe, expect, it } from "vitest";
import { ATLAS } from "@/lib/evidence";
import { EXPLORER_HOST, explorerLabelKey } from "@/lib/atlasLabels";
import { translate } from "@/lib/i18n";

const NAME: Record<string, string> = { near: "NearBlocks", base: "Basescan", sol: "Solscan" };

describe("atlas explorer labels name the explorer their link opens", () => {
  it("each chain's label names its explorer", () => {
    for (const chain of ["near", "base", "sol"]) {
      expect(translate(explorerLabelKey(chain))).toContain(NAME[chain]);
    }
  });

  it("settlement links open the host the label names (Base to basescan, SOL to solscan)", () => {
    const settled = ATLAS.filter((a) => a.kind === "settle");
    expect(settled.map((a) => a.chain).sort()).toEqual(["base", "sol"]);
    for (const a of settled) {
      expect(a.href, a.chain).toBeTruthy();
      expect(new URL(a.href!).hostname).toBe(EXPLORER_HOST[a.chain]);
      expect(translate(explorerLabelKey(a.chain))).toContain(NAME[a.chain]);
      expect(translate(explorerLabelKey(a.chain))).not.toContain("NearBlocks");
    }
  });

  it("the NEAR label is NearBlocks, not the Base or SOL names", () => {
    expect(translate(explorerLabelKey("near"))).toBe("Open on NearBlocks");
  });
});
