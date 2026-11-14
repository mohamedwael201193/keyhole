import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/landing/Proof.tsx", import.meta.url), "utf8");

describe("SupplyStat never leaves a blank value for long", () => {
  it("polls fast while the supply is missing and slow once a number lands", () => {
    // Recovery mode: while n is null the interval is 3 s, so a slow first read is
    // retried inside the 15 s the viewport test allows. Steady mode: once a number
    // lands the interval is 60 s (the live-update cadence).
    expect(source).toContain("missing ? 3_000 : 60_000");
    expect(source).toContain("const missing = n == null;");
  });

  it("the effect re-runs when the missing state flips, so the interval switches modes", () => {
    // Without this dependency the 3 s interval would keep firing after a number
    // lands (or the 60 s interval would never start recovering).
    expect(source).toMatch(/useEffect\(\(\) => \{[\s\S]*?\}, \[missing\]\)/);
  });

  it("still reads immediately on mount and on focus", () => {
    expect(source).toContain("tick();");
    expect(source).toContain("addEventListener(\"focus\", onFocus);");
  });

  it("only accepts an integer supply and keeps the server value until a fresh read lands", () => {
    expect(source).toContain("Number.isInteger(j?.supply)");
    expect(source).toContain("useState(initial)");
    expect(source).toContain("{n == null ? \"—\" : n}");
  });
});

describe("pledge page contains its floating-key overhang", () => {
  it(".plg clips horizontally only, so the key tip still shows above the card", () => {
    const css = readFileSync(new URL("../app/pledge/pledge.css", import.meta.url), "utf8");
    const plg = css.match(/\.plg \{[^}]*\}/)?.[0] ?? "";
    expect(plg).toContain("overflow-x: clip;");
    expect(plg).toContain("overflow-y: visible;");
    // The stage itself must stay fully visible: the key tip lives above the card.
    const stage = css.match(/\.plg-stage \{[^}]*\}/)?.[0] ?? "";
    expect(stage).toContain("overflow: visible;");
  });
});
