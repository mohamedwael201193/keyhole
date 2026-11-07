import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// usePathname is read from a mutable slot so one test file can render the public and the app chrome.
const route = vi.hoisted(() => ({ path: null as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => route.path }));
// The account control reads the wallet context; the real provider pulls in the wallet SDKs, which tests do not need.
vi.mock("@/lib/wallet", () => ({
  useWallet: () => ({ accountId: null, connect: () => {}, disconnect: async () => {}, restoring: false, mismatch: null }),
}));

import { APP_NAV, APP_ROUTES, AppNav, AppShell, hashOf, isAppRoute, isItemActive, type AppNavItem } from "@/components/app/AppShell";
import { SiteFrame } from "@/components/SiteFrame";
import { I18nProvider } from "@/lib/i18n";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const item = (id: string): AppNavItem => APP_NAV.flatMap((g) => g.items).find((i) => i.id === id)!;
const withI18n = (el: ReturnType<typeof createElement>) => createElement(I18nProvider, null, el);

describe("app routes", () => {
  it("the holder routes render inside the shell, URLs unchanged", () => {
    expect([...APP_ROUTES].sort()).toEqual(["/dashboard", "/gallery", "/key", "/mint", "/pnl", "/settle", "/vault"]);
    for (const p of ["/dashboard", "/vault", "/mint", "/settle", "/gallery", "/key", "/pnl", "/key/extra"]) expect(isAppRoute(p), p).toBe(true);
  });

  it("public pages keep the public top bar", () => {
    for (const p of ["/", "/start", "/judge", "/verify", "/demo", "/ask", "/atlas", "/identity", "/source", "/galleryx", "/keys", "/vaults", null, undefined]) {
      expect(isAppRoute(p), String(p)).toBe(false);
    }
  });
});

describe("sidebar items", () => {
  it("Workspace lists Overview, My keys, Quotes & swaps, Vault, Mint and Activity, in that order", () => {
    const ws = APP_NAV.find((g) => g.title === "Workspace")!;
    expect(ws.items.map((i) => [i.label, i.href])).toEqual([
      ["Overview", "/dashboard"],
      ["My keys", "/gallery?mine=1"],
      ["Quotes & swaps", "/settle"],
      ["Vault", "/vault"],
      ["Mint", "/mint"],
      ["Activity", "/dashboard#activity"],
    ]);
  });

  it("Prove it lists Judge and Verify", () => {
    const pi = APP_NAV.find((g) => g.title === "Prove it")!;
    expect(pi.items.map((i) => [i.label, i.href])).toEqual([["Judge", "/judge"], ["Verify", "/verify"]]);
  });

  it("every link points at a real route", () => {
    const known = ["/dashboard", "/gallery", "/settle", "/vault", "/mint", "/judge", "/verify"];
    for (const i of APP_NAV.flatMap((g) => g.items)) expect(known).toContain(i.href.split("#")[0].split("?")[0]);
  });
});

describe("active state", () => {
  it("Overview is active on /dashboard, and yields to Activity on #activity", () => {
    expect(isItemActive(item("overview"), "/dashboard", "")).toBe(true);
    expect(isItemActive(item("overview"), "/dashboard", "#activity")).toBe(false);
    expect(isItemActive(item("activity"), "/dashboard", "#activity")).toBe(true);
    expect(isItemActive(item("activity"), "/dashboard", "")).toBe(false);
  });

  it("My keys is active on /gallery and on a key page", () => {
    expect(isItemActive(item("keys"), "/gallery", "")).toBe(true);
    expect(isItemActive(item("keys"), "/key", "")).toBe(true);
    expect(isItemActive(item("keys"), "/vault", "")).toBe(false);
  });

  it("only one item is active on each app route", () => {
    for (const p of ["/vault", "/mint", "/settle", "/gallery", "/key", "/pnl"]) {
      const on = APP_NAV.flatMap((g) => g.items).filter((i) => isItemActive(i, p, ""));
      expect(on.length, p).toBe(1);
    }
  });

  it("nothing is active without a pathname (server render before the route is known)", () => {
    expect(isItemActive(item("vault"), null, "")).toBe(false);
  });

  it("hashOf reads the hash of a link", () => {
    expect(hashOf("/dashboard#activity")).toBe("#activity");
    expect(hashOf("/vault")).toBe("");
  });
});

describe("AppNav markup", () => {
  const html = (pathname: string | null, hash = "") => renderToStaticMarkup(createElement(AppNav, { pathname, hash }));

  it("marks the current page with aria-current on exactly one link", () => {
    const m = html("/vault");
    expect(m.match(/aria-current="page"/g)?.length).toBe(1);
    const tag = m.split("<a ").find((seg) => seg.includes('href="/vault"'))!;
    expect(tag).toContain('aria-current="page"');
  });

  it("renders a labelled navigation landmark with every item and a test id per item", () => {
    const m = html("/dashboard");
    expect(m).toContain('aria-label="App navigation"');
    for (const i of APP_NAV.flatMap((g) => g.items)) expect(m).toContain(`data-testid="app-nav-${i.id}"`);
    expect(m).toContain("Prove it");
  });

  it("the activity link is current only with its hash", () => {
    const m = html("/dashboard", "#activity");
    const act = m.split("<a ").find((seg) => seg.includes('data-testid="app-nav-activity"'))!;
    expect(act).toContain('aria-current="page"');
    const ov = m.split("<a ").find((seg) => seg.includes('data-testid="app-nav-overview"'))!;
    expect(ov).not.toContain('aria-current="page"');
  });
});

describe("AppShell", () => {
  it("renders the top bar with the network pill and the account control, and the sidebar beside the page", () => {
    route.path = "/vault";
    const m = renderToStaticMarkup(withI18n(createElement(AppShell, null, createElement("p", null, "PAGE"))));
    expect(m).toContain('data-testid="app-shell"');
    expect(m).toContain('data-testid="network-pill"');
    expect(m).toContain("NEAR mainnet");
    expect(m).toContain('data-testid="connect"');
    expect(m).toContain('id="main"');
    expect(m).toContain('href="#main"');
    expect(m).toContain('aria-controls="app-side"');
    expect(m).toContain('aria-label="App navigation"');
    expect(m).toContain("PAGE");
    expect(m).not.toContain('data-testid="nav-more"');
  });

  it("the drawer button is labelled and starts closed", () => {
    route.path = "/vault";
    const m = renderToStaticMarkup(withI18n(createElement(AppShell, null, "x")));
    expect(m).toMatch(/data-testid="app-burger"[^>]*aria-expanded="false"|aria-expanded="false"[^>]*data-testid="app-burger"/);
    expect(m).toContain("app-side");
    expect(m).not.toMatch(/class="app-side open"/);
  });
});

describe("SiteFrame picks the chrome per route", () => {
  const nav = createElement("nav", { "data-chrome": "public" }, "PUBLIC");
  const footer = createElement("footer", { "data-chrome": "footer" }, "FOOT");
  const render = (path: string | null) => {
    route.path = path;
    // children is a required prop of SiteFrame, so it is passed in props here for the type check.
    // eslint-disable-next-line react/no-children-prop
    return renderToStaticMarkup(withI18n(createElement(SiteFrame, { nav, footer, children: createElement("p", null, "BODY") })));
  };

  it("app routes get the shell and the footer, but no public nav", () => {
    const m = render("/dashboard");
    expect(m).toContain('data-testid="app-shell"');
    expect(m).not.toContain('data-chrome="public"');
    expect(m).toContain('data-chrome="footer"');
    expect(m).toContain("BODY");
  });

  it("public routes keep the public nav, footer and main", () => {
    const m = render("/judge");
    expect(m).not.toContain('data-testid="app-shell"');
    expect(m).toContain('data-chrome="public"');
    expect(m).toContain('data-chrome="footer"');
    expect(m).toContain('<main id="main">');
  });
});

describe("root layout wiring", () => {
  it("loads the shell stylesheet and renders the route-aware frame", () => {
    const layout = src("../app/layout.tsx");
    expect(layout).toContain('import "./app-shell.css"');
    expect(layout).toContain("<SiteFrame nav={<Nav />} footer={<Footer />}>");
  });

  it("the public Nav still owns the account control and keeps its test ids", () => {
    const nav = src("../components/Nav.tsx");
    expect(nav).toContain("<AccountControl />");
    expect(nav).toContain('data-testid="nav-more"');
    expect(nav).toContain('data-testid="more-menu"');
    const acct = src("../components/AccountControl.tsx");
    expect(acct).toContain('data-testid="connect"');
    expect(acct).toContain('data-testid="account"');
    expect(acct).toContain('data-testid="account-menu"');
  });
});
