import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const css = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const tokens = css("../app/tokens.css");
const legacy = ["polish.css", "heirloom.css", "design2.css", "ui.css", "globals.css"].map((f) => [f, css(`../app/${f}`)] as const);

/** Names declared in tokens.css, one per `--name:` declaration. */
const declared = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

describe("design tokens v3", () => {
  it("declares the token families the system promises", () => {
    const required = [
      "--surface", "--raised", "--sunken", "--ink", "--ink-2", "--muted", "--line", "--line-strong",
      "--primary", "--primary-ink", "--accent", "--accent-ink", "--success", "--warn", "--danger", "--info",
      "--vault", "--vault-ink", "--focus-ring",
      "--text-display", "--text-title", "--text-heading", "--text-lead", "--text-body", "--text-small",
      "--font-display", "--font-ui", "--font-mono",
      "--radius-sm", "--radius-md", "--radius-lg", "--radius-pill",
      "--shadow-1", "--shadow-2", "--space-1", "--space-8",
      "--dur-fast", "--dur-base", "--dur-slow", "--ease-out", "--ease-spring",
    ];
    for (const name of required) expect(declared.has(name), name).toBe(true);
  });

  it("keeps the 13px floor on the smallest text token", () => {
    expect(tokens).toMatch(/--text-small:\s*13px/);
  });

  it("no legacy file aliases a name to itself (a cycle is invalid CSS)", () => {
    for (const [file, text] of legacy) {
      for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:\s*var\((--[a-z0-9-]+)\)/g)) {
        expect(m[1], `${file}: ${m[0]}`).not.toBe(m[2]);
      }
    }
  });

  it("legacy role names alias the tokens rather than repeat their values", () => {
    const polish = legacy.find(([f]) => f === "polish.css")![1];
    expect(polish).toMatch(/--bg:\s*var\(--surface\)/);
    expect(polish).toMatch(/--sf:\s*var\(--raised\)/);
    expect(polish).toMatch(/--teal:\s*var\(--primary\)/);
    expect(polish).not.toMatch(/--bg:\s*#/);
  });

  it("layout imports the token file first, before any stylesheet", () => {
    const layout = css("../app/layout.tsx");
    const imports = [...layout.matchAll(/^import ["'](\.\/[^"']+\.css)["']/gm)].map((m) => m[1]);
    expect(imports[0]).toBe("./tokens.css");
  });
});
