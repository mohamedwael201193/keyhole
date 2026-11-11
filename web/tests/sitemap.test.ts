import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";

describe("public crawl files", () => {
  it("lists public static routes and leaves the API and per-token lend pages out", () => {
    const urls = sitemap().map((row) => row.url);
    expect(urls.some((u) => u.endsWith("/holders"))).toBe(true);
    expect(urls.some((u) => u.includes("/api/"))).toBe(false);
    expect(urls.some((u) => u.includes("/pledge/lend"))).toBe(false);
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rules.disallow).toEqual(["/api/", "/pledge/lend/"]);
  });
});