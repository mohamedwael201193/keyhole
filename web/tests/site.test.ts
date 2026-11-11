import { describe, expect, it } from "vitest";
import { CANONICAL_SITE, siteUrl } from "@/lib/site";

describe("canonical site", () => {
  it("falls back when unset or unusable", () => {
    expect(siteUrl(undefined)).toBe(CANONICAL_SITE);
    expect(siteUrl("")).toBe(CANONICAL_SITE);
    expect(siteUrl("not a url")).toBe(CANONICAL_SITE);
    expect(siteUrl("ftp://example.test")).toBe(CANONICAL_SITE);
  });
  it("keeps a configured origin and drops a path", () => {
    expect(siteUrl("https://preview.example.test/app")).toBe("https://preview.example.test");
  });
});
