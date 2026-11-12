import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Checkbox, Toggle } from "@/components/ui/checkbox";

const noop = () => {};
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

describe("styled Checkbox is an accessible control", () => {
  it("is a real checkbox inside its label, so the label names it and a click on the label toggles it", () => {
    const m = html(createElement(Checkbox, { checked: false, onChange: noop, label: "I accept the exact 0.0032 NEAR storage charge", id: "c1" }));
    expect(m).toMatch(/<label[^>]*for="c1"/);
    expect(m).toMatch(/<input[^>]*type="checkbox"/);
    expect(m).toContain("I accept the exact 0.0032 NEAR storage charge");
    expect(m.indexOf("<label")).toBeLessThan(m.indexOf("<input"));
  });

  it("reports the checked state through the native input, not colour alone", () => {
    expect(html(createElement(Checkbox, { checked: true, onChange: noop, label: "x", id: "c2" }))).toMatch(/<input[^>]*checked/);
    expect(html(createElement(Checkbox, { checked: false, onChange: noop, label: "x", id: "c3" }))).not.toMatch(/<input[^>]*checked/);
  });

  it("is keyboard operable: a native, focusable input (Space toggles it) that is hidden only by opacity", () => {
    const m = html(createElement(Checkbox, { checked: false, onChange: noop, label: "x", id: "c4" }));
    expect(m).not.toContain("tabindex");
    expect(m).not.toContain(" hidden");
    const css = readFileSync(new URL("../app/system.css", import.meta.url), "utf8");
    const rule = css.match(/\.kh-check-input\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("opacity: 0");
    expect(rule).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    expect(css).toMatch(/\.kh-check-input:focus-visible \+ \.kh-check-box/);
  });

  it("ties a hint to the control and passes disabled through", () => {
    const m = html(createElement(Checkbox, { checked: false, onChange: noop, label: "x", hint: "One line", id: "c5", disabled: true }));
    expect(m).toContain('aria-describedby="c5-hint"');
    expect(m).toContain('id="c5-hint"');
    expect(m).toMatch(/<input[^>]*disabled/);
  });

  it("hides the drawn box from assistive tech", () => {
    expect(html(createElement(Checkbox, { checked: true, onChange: noop, label: "x" }))).toMatch(/kh-check-box"[^>]*aria-hidden="true"/);
  });
});

describe("styled Toggle is an accessible switch", () => {
  it("is a button with role=switch, a state and a name", () => {
    const on = html(createElement(Toggle, { checked: true, onChange: noop, label: "Notify me", id: "t1" }));
    expect(on).toMatch(/<button[^>]*role="switch"/);
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain('aria-labelledby="t1-label"');
    expect(on).toContain('id="t1-label"');
    expect(html(createElement(Toggle, { checked: false, onChange: noop, label: "Notify me", id: "t2" }))).toContain('aria-checked="false"');
  });

  it("is a native button, so Space and Enter flip it", () => {
    expect(html(createElement(Toggle, { checked: false, onChange: noop, label: "x", id: "t3" }))).toMatch(/<button[^>]*type="button"/);
  });
});
