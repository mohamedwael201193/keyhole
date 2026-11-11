import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { publicOrderCensus } from "@/lib/settlements";
import { buildOrders } from "@/components/activity/orders";

describe("public order census", () => {
  it("is the sealed vault swap plus every listed 1Click order, the same set Activity counts", () => {
    const c = publicOrderCensus();
    expect(c.total).toBe(buildOrders({}).length);
    expect(c.vaultSwaps).toBe(1);
    expect(c.oneClick).toBe(c.total - 1);
    expect(c.label).toBe("Public orders");
    expect(c.detail).toBe(`${c.vaultSwaps} sealed vault swap and ${c.oneClick} 1Click orders`);
  });
  it("home and Activity both read that census", () => {
    const landing = readFileSync(new URL("../components/Landing.tsx", import.meta.url), "utf8");
    const settle = readFileSync(new URL("../app/settle/view.tsx", import.meta.url), "utf8");
    expect(landing).toContain("publicOrderCensus()");
    expect(landing).not.toContain("SETTLEMENTS.length");
    expect(settle).toContain("publicOrderCensus().label");
    expect(settle).toContain("publicOrderCensus().detail");
  });
});
