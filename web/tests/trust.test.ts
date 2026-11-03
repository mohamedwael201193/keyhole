import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const root = `${__dirname}/../..`;
describe("trust labels", () => {
  it("every /judge step carries a trust label and the page has the legend", () => {
    const src = readFileSync(`${root}/web/app/judge/page.tsx`, "utf8");
    const steps = src.split('<h2><span>').slice(1);
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) expect(s.slice(0, 400)).toContain("<Trust src=");
    expect(src).toContain("<TrustLegend />");
  });
  it("every /verify check row and both DCAP/PCS panels carry a trust label", () => {
    const src = readFileSync(`${root}/web/app/verify/view.tsx`, "utf8");
    const rows = src.split("\n").filter((l) => l.includes('className="ck"') || l.includes('<summary>'));
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const r of rows) expect(r).toContain("<Trust src=");
  });
});
