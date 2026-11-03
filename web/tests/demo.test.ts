import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_STEPS } from "@/lib/demo";
const root = `${__dirname}/../..`;
const summary = JSON.parse(readFileSync(`${root}/docs/evidence/mainnet-e2e/SUMMARY.json`, "utf8")) as { call_id?: string; ok?: boolean }[];
const dir = `${root}/docs/evidence/mainnet-e2e`;
const files = readdirSync(dir).filter((f) => /^\d\d_.*\.json$/.test(f)).map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")).call_id).filter(Boolean);
describe("demo vault is recorded mainnet data", () => {
  it("every demo call id is a recorded mainnet E2E call", () => {
    for (const s of DEMO_STEPS) for (const p of s.proofs) if (p.kind === "call") expect(files).toContain(p.ref);
  });
  it("the trade step matches the recorded swap output", () => {
    const ev = JSON.parse(readFileSync(`${root}/docs/evidence/mainnet-e2e/08_swap_0.005_usdc.json`, "utf8"));
    const st = DEMO_STEPS.find((s) => s.id === "trade")!;
    expect(st.proofs.some((p) => p.ref === ev.output.intent_hash)).toBe(true);
    expect(ev.output.status).toBe("success");
  });
  it("refused steps match refused records", () => {
    const g = DEMO_STEPS.find((s) => s.id === "guard")!;
    for (const p of g.proofs) expect(summary.find((s) => s.call_id === p.ref)?.ok).toBe(false);
  });
  it("the page shows the read-only demo banner", () => {
    const src = readFileSync(`${root}/web/app/demo/view.tsx`, "utf8");
    expect(src).toContain("DEMO · read-only");
    expect(src).not.toMatch(/signMessage|useWallet|fetch\(/);
  });
});
