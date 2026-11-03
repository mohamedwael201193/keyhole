// Pages that read the chain must not be prerendered at build time (a slow RPC would fail the build).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const pages = ["app/page.tsx", "app/gallery/page.tsx", "app/identity/page.tsx"];
describe("chain-reading pages render per request", () => {
  it.each(pages)("%s is force-dynamic and not ISR", (p) => {
    const s = readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
    expect(s).toMatch(/export const dynamic = "force-dynamic"/);
    expect(s).not.toMatch(/export const revalidate/);
  });
});
