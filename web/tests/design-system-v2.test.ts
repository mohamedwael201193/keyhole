import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "@/components/ui/button";
import { Badge, BADGE_STATUS, badgeFor } from "@/components/ui";
import { StatCard } from "@/components/ui/card";
import { TokenIcon } from "@/components/TokenIcon";
import { monogram, tokenIcon } from "@/lib/tokenIcons";
import { localTokenMarkUrl } from "@/lib/tokenMarks";
import { CountUp, FadeUp, GlowReveal, Parallax, Stagger, Tilt } from "@/components/motion";
import { TxResult } from "@/components/TxResult";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("Button", () => {
  it("renders a button with the primary variant and type=button by default", () => {
    const m = html(createElement(Button, {}, "Mint a key"));
    expect(m).toMatch(/^<button /);
    expect(m).toContain('type="button"');
    expect(m).toContain("kh-btn kh-btn--primary");
    expect(m).toContain("Mint a key");
    expect(m).not.toContain("aria-busy");
  });

  it("loading: spinner, aria-busy, screen-reader label, and no second press", () => {
    const m = html(createElement(Button, { loading: true, variant: "secondary" }, "Sign in"));
    expect(m).toContain('aria-busy="true"');
    expect(m).toContain('data-loading="true"');
    expect(m).toContain("disabled");
    expect(m).toContain('class="spin"');
    expect(m).toContain("Loading");
    expect(m).toContain("kh-btn--secondary");
  });

  it("disabled: the native disabled attribute and no busy state", () => {
    const m = html(createElement(Button, { disabled: true }, "Get quote"));
    expect(m).toContain("disabled");
    expect(m).not.toContain("aria-busy");
    expect(m).not.toContain('data-loading="true"');
  });

  it("sizes and variants map to classes; md adds no size class", () => {
    expect(html(createElement(Button, { size: "sm" }, "x"))).toContain("kh-btn--sm");
    expect(html(createElement(Button, { size: "lg" }, "x"))).toContain("kh-btn--lg");
    expect(html(createElement(Button, { size: "md" }, "x"))).not.toMatch(/kh-btn--(sm|lg)/);
    expect(html(createElement(Button, { variant: "banner" }, "x"))).toContain("kh-btn--banner");
    expect(html(createElement(Button, { variant: "ghost" }, "x"))).toContain("kh-btn--ghost");
  });

  it("with href renders a link (Next Link) with the same classes", () => {
    const m = html(createElement(Button, { href: "/mint", variant: "banner" }, "Mint"));
    expect(m).toMatch(/^<a /);
    expect(m).toContain('href="/mint"');
    expect(m).toContain("kh-btn kh-btn--banner");
  });

  it("link while loading is aria-disabled and busy", () => {
    const m = html(createElement(Button, { href: "/verify", loading: true }, "Verify"));
    expect(m).toContain('aria-busy="true"');
    expect(m).toContain('aria-disabled="true"');
  });

  it("passes testid through", () => {
    expect(html(createElement(Button, { testid: "start-google" }, "Google"))).toContain('data-testid="start-google"');
  });
});

describe("Badge status mapping", () => {
  it("maps each of the seven statuses to one tone and one label", () => {
    expect(Object.keys(BADGE_STATUS).sort()).toEqual(["completed", "expired", "failed", "pending", "refunded", "settled", "success"]);
    expect(badgeFor("settled")).toEqual({ tone: "ok", label: "Settled" });
    expect(badgeFor("completed")).toEqual({ tone: "ok", label: "Completed" });
    expect(badgeFor("success")).toEqual({ tone: "ok", label: "Success" });
    expect(badgeFor("pending")).toEqual({ tone: "warn", label: "Pending" });
    expect(badgeFor("refunded")).toEqual({ tone: "info", label: "Refunded" });
    expect(badgeFor("expired")).toEqual({ tone: "wait", label: "Expired" });
    expect(badgeFor("failed")).toEqual({ tone: "bad", label: "Failed" });
  });

  it("is case-insensitive and returns null for other words", () => {
    expect(badgeFor("SUCCESS")).toEqual({ tone: "ok", label: "Success" });
    expect(badgeFor("PENDING_DEPOSIT")).toBeNull();
    expect(badgeFor("")).toBeNull();
    expect(badgeFor(undefined)).toBeNull();
  });

  it("status alone renders the tone class, the printed label, and data-status", () => {
    const m = html(createElement(Badge, { status: "failed" }));
    expect(m).toContain("ubadge bad");
    expect(m).toContain(">Failed<");
    expect(m).toContain('data-status="failed"');
  });

  it("explicit tone and children keep working (existing callers)", () => {
    const m = html(createElement(Badge, { tone: "ok" }, "Allowed"));
    expect(m).toContain("ubadge ok");
    expect(m).toContain(">Allowed<");
  });
});

describe("StatCard", () => {
  it("renders no value element when none is given (no placeholder numbers)", () => {
    const m = html(createElement(StatCard, { label: "Settled orders", empty: "Sign to see your history" }));
    expect(m).toContain("Settled orders");
    expect(m).toContain("Sign to see your history");
    expect(m).not.toContain("kh-stat-value");
  });

  it("renders the real value when given", () => {
    const m = html(createElement(StatCard, { label: "My keys", value: "3" }));
    expect(m).toContain('<span class="kh-stat-value">3</span>');
    expect(m).not.toContain("kh-stat-empty");
  });

  it("zero is a real value and is shown", () => {
    const m = html(createElement(StatCard, { label: "My keys", value: 0 }));
    expect(m).toContain('kh-stat-value">0<');
  });
});

describe("TokenIcon (a wrapper over TokenMark)", () => {
  it("first paint is the monogram; the self-hosted mark is the first candidate and is probed in the browser", () => {
    const usdc = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
    const m = html(createElement(TokenIcon, { assetId: usdc, symbol: "USDC" }));
    expect(m).not.toContain("<img");
    expect(m).toContain('data-mark="monogram"');
    expect(localTokenMarkUrl({ assetId: usdc, symbol: "USDC" })).toBe("/tokens/usdc.svg");
  });

  it("wNEAR uses the NEAR mark", () => {
    expect(tokenIcon({ assetId: "nep141:wrap.near", symbol: "wNEAR" })?.src).toBe("/tokens/near.svg");
  });

  it("falls back to a monogram from the symbol when there is no mark", () => {
    const m = html(createElement(TokenIcon, { assetId: "nep141:unknown.near", symbol: "ZZZ" }));
    expect(m).not.toContain("<img");
    expect(m).toContain('class="kh-tmark-glyph"');
    expect(m).toContain(">ZZ<");
  });

  it("monogram is ? for an empty symbol and nothing maps", () => {
    expect(monogram("")).toBe("?");
    expect(monogram(undefined)).toBe("?");
    expect(monogram("wNEAR")).toBe("WN");
    expect(tokenIcon({ assetId: "nep141:nope.near" })).toBeNull();
  });

  it("chain names map to marks", () => {
    expect(tokenIcon({ chain: "Arbitrum" })?.src).toBe("/tokens/arb.svg");
    expect(tokenIcon({ chain: "solana" })?.src).toBe("/tokens/sol.svg");
  });

  it("standalone icon gets a role and label; beside text it stays decorative", () => {
    const labelled = html(createElement(TokenIcon, { symbol: "USDT", label: "USDT" }));
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="USDT"');
    const deco = html(createElement(TokenIcon, { symbol: "USDT" }));
    expect(deco).toContain('aria-hidden="true"');
    expect(deco).not.toContain('role="img"');
  });
});

describe("CountUp", () => {
  it("renders the final real value on the server, with grouping", () => {
    expect(html(createElement(CountUp, { value: 1234 }))).toContain(">1,234<");
  });

  it("honours decimals and zero", () => {
    expect(html(createElement(CountUp, { value: 1234.5, decimals: 2 }))).toContain(">1,234.50<");
    expect(html(createElement(CountUp, { value: 0 }))).toContain(">0<");
  });
});

describe("FadeUp (no JavaScript)", () => {
  it("server markup shows the children with no hidden inline style", () => {
    const m = html(createElement(FadeUp, null, createElement("p", null, "Settled in 4 steps")));
    expect(m).toContain("Settled in 4 steps");
    expect(m).not.toContain("opacity");
  });
});

describe("TxResult", () => {
  const hash = "7Hh2dGkQ9rXy3pJ1wM6vLsa8NcTzKbEe4uFiYgRo5DqA";

  it("confirmed: NEAR Blocks link, second explorer, copy button, polite status", () => {
    const m = html(createElement(TxResult, { state: "confirmed", hash, testid: "mint-tx" }));
    expect(m).toContain('data-state="confirmed"');
    expect(m).toContain('role="status"');
    expect(m).toContain(`https://nearblocks.io/txns/${hash}`);
    expect(m).toContain(`https://pikespeak.ai/transaction-viewer/${hash}`);
    expect(m).toContain("Copy hash");
    expect(m).toContain("Confirmed on NEAR");
    expect(m).toContain('data-testid="mint-tx-status"');
  });

  it("attested call id links to /verify", () => {
    const m = html(createElement(TxResult, { state: "confirmed", callId: "c0ffee12" }));
    expect(m).toContain('href="/verify?call=c0ffee12"');
    expect(m).toContain("Attested call");
    expect(m).not.toContain("nearblocks.io");
  });

  it("pending: waiting title and no proof links until a hash exists", () => {
    const m = html(createElement(TxResult, { state: "pending" }));
    expect(m).toContain("Waiting for the chain");
    expect(m).toContain('data-state="pending"');
    expect(m).not.toContain("nearblocks.io");
    expect(m).not.toContain("/verify?call=");
  });

  it("failed: alert role, plain reason, no success wording", () => {
    const m = html(createElement(TxResult, { state: "failed", reason: "The enclave refused the limit." }));
    expect(m).toContain('role="alert"');
    expect(m).toContain("The enclave refused the limit.");
    expect(m).toContain("Not completed");
    expect(m).not.toContain("Confirmed");
  });

  it("children slot renders after the proof rows", () => {
    const m = html(createElement(TxResult, { state: "confirmed", hash }, createElement("p", null, "Key reveal here")));
    expect(m).toContain("Key reveal here");
    expect(m.indexOf("Key reveal here")).toBeGreaterThan(m.indexOf("nearblocks.io"));
  });
});

describe("Motion primitives render their final state on the server", () => {
  it("Stagger and GlowReveal keep their children visible with no hidden style", () => {
    const s = html(createElement(Stagger, null, createElement("li", null, "One"), createElement("li", null, "Two")));
    expect(s).toContain(">One<");
    expect(s).toContain(">Two<");
    expect(s).not.toContain("opacity");
    const g = html(createElement(GlowReveal, null, createElement("p", null, "Glow body")));
    expect(g).toContain("Glow body");
    expect(g).toContain('data-in="false"');
    expect(g).not.toContain("opacity");
  });

  it("Parallax and Tilt render their children and the flat-element hooks", () => {
    const p = html(createElement(Parallax, { speed: 0.1 }, createElement("span", null, "Layer")));
    expect(p).toContain("kh-parallax");
    expect(p).toContain(">Layer<");
    const t = html(createElement(Tilt, null, createElement("span", null, "Key card")));
    expect(t).toContain("kh-tilt");
    expect(t).toContain('data-tilt="on"');
    expect(t).toContain(">Key card<");
  });
});
