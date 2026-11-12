import { describe, expect, it } from "vitest";
import { activeMatch, SITE_LINKS } from "@/components/Nav";

describe("nav current item", () => {
  it("only the longest matching item is current on /verify/path (Proof is not)", () => {
    expect(activeMatch("/verify/path")).toBe("/verify/path");
    expect(activeMatch("/verify/path/")).toBe("/verify/path");
  });
  it("Proof is current on /verify and on other /verify sub-routes", () => {
    expect(activeMatch("/verify")).toBe("/verify");
    expect(activeMatch("/verify/other")).toBe("/verify");
  });
  it("home only matches the root", () => {
    expect(activeMatch("/")).toBe("/");
    expect(activeMatch("/attack")).toBe("/attack");
    expect(activeMatch("/unknown")).toBeNull();
  });
  it("every nav item is reachable by a matching path", () => {
    for (const l of SITE_LINKS) expect(activeMatch(l.match)).toBe(l.match);
  });
});
