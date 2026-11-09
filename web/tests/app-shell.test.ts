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

import { APP_NAV, APP_ROUTES, AppNav, AppShell, AppTabs, hashOf, isAppRoute, isItemActive, pageTitle, type AppNavItem } from "@/components/app/AppShell";
import { SiteFrame } from "@/components/SiteFrame";
import { I18nProvider } from "@/lib/i18n";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const item = (id: string): AppNavItem => APP_NAV.flatMap((g) => g.items).find((i) => i.id === id)!;
const withI18n = (el: ReturnType<typeof createElement>) => createElement(I18nProvider, null, el);

describe("app routes", () => {
  it("the holder routes render inside the shell, URLs unchanged; /swap and /keys are app routes in v3", () => {
    expect([...APP_ROUTES].sort()).toEqual(["/attack", "/dashboard", "/gallery", "/key", "/keys", "/mint", "/pnl", "/settle", "/swap", "/vault", "/verify"]);
    for (const p of ["/dashboard", "/vault", "/mint", "/settle", "/swap", "/keys", "/gallery", "/key", "/pnl", "/key/extra", "/verify", "/attack"]) expect(isAppRoute(p), p).toBe(true);
  });

  it("public pages keep the public top bar", () => {
    for (const p of ["/", "/start", "/judge", "/demo", "/ask", "/atlas", "/identity", "/source", "/galleryx", "/vaults", "/swapx", null, undefined]) {
      expect(isAppRoute(p), String(p)).toBe(false);
    }
  });
});

describe("sidebar items", () => {
  it("lists Overview, Swap, Vault, Keys and Activity, in that order", () => {
    const ws = APP_NAV.find((g) => g.title === "Workspace")!;
    expect(ws.items.map((i) => [i.label, i.href])).toEqual([
      ["Overview", "/dashboard"],
      ["Swap", "/swap"],
      ["Vault", "/vault"],
      ["Keys", "/keys"],
      ["Activity", "/settle"],
    ]);
  });

  it("every link points at a real route", () => {
    const known = ["/dashboard", "/swap", "/vault", "/keys", "/settle", "/verify", "/attack"];
    for (const i of APP_NAV.flatMap((g) => g.items)) expect(known).toContain(i.href.split("#")[0].split("?")[0]);
  });
});

describe("active state", () => {
  it("Overview is active on /dashboard only; Activity is the settled and refunded orders page", () => {
    expect(isItemActive(item("overview"), "/dashboard", "")).toBe(true);
    expect(isItemActive(item("overview"), "/settle", "")).toBe(false);
    expect(isItemActive(item("activity"), "/settle", "")).toBe(true);
    expect(isItemActive(item("activity"), "/dashboard", "#activity")).toBe(false);
    expect(isItemActive(item("activity"), "/dashboard", "")).toBe(false);
  });

  it("Keys is active on /keys, /gallery, a key page and /mint (mint lives inside keys)", () => {
    for (const p of ["/keys", "/gallery", "/key", "/mint"]) expect(isItemActive(item("keys"), p, ""), p).toBe(true);
    expect(isItemActive(item("keys"), "/vault", "")).toBe(false);
  });

  it("Swap is active on /swap only; the settlements history belongs to Activity", () => {
    expect(isItemActive(item("swap"), "/swap", "")).toBe(true);
    expect(isItemActive(item("swap"), "/settle", "")).toBe(false);
    expect(isItemActive(item("swap"), "/vault", "")).toBe(false);
  });

  it("only one item is active on each app route", () => {
    for (const p of ["/vault", "/mint", "/settle", "/swap", "/keys", "/gallery", "/key", "/pnl"]) {
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

describe("page titles", () => {
  it("the top bar names the page; unknown routes fall back to the product name", () => {
    expect(pageTitle("/dashboard")).toBe("Overview");
    expect(pageTitle("/swap")).toBe("Swap");
    expect(pageTitle("/keys")).toBe("Keys");
    expect(pageTitle("/key/12")).toBe("Key");
    expect(pageTitle("/keys/extra")).toBe("Keys");
    expect(pageTitle("/settle")).toBe("Activity");
    expect(pageTitle("/nothing")).toBe("KEYHOLE");
    expect(pageTitle(null)).toBe("KEYHOLE");
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
  });

  it("the activity link is current on /settle and points there", () => {
    const m = html("/settle");
    const act = m.split("<a ").find((seg) => seg.includes('data-testid="app-nav-activity"'))!;
    expect(act).toContain('aria-current="page"');
    expect(act).toContain('href="/settle"');
    const sw = m.split("<a ").find((seg) => seg.includes('data-testid="app-nav-swap"'))!;
    expect(sw).not.toContain('aria-current="page"');
  });
});

describe("Mint a key in the sidebar", () => {
  const html = (mint?: boolean) => renderToStaticMarkup(createElement(AppNav, { pathname: "/keys", hash: "", mint }));

  it("is not in the fixed sidebar list, and shows after Keys only when the key store says there is no key", () => {
    expect(APP_NAV.flatMap((g) => g.items).map((i) => i.id)).not.toContain("mint");
    expect(html()).not.toContain('data-testid="app-nav-mint"');
    const m = html(true);
    expect(m).toContain('data-testid="app-nav-mint"');
    expect(m).toContain('href="/mint"');
    expect(m.indexOf('data-testid="app-nav-keys"')).toBeLessThan(m.indexOf('data-testid="app-nav-mint"'));
    expect(m.indexOf('data-testid="app-nav-mint"')).toBeLessThan(m.indexOf('data-testid="app-nav-activity"'));
  });
});

describe("AppTabs (phones)", () => {
  const html = (pathname: string | null) => renderToStaticMarkup(createElement(AppTabs, { pathname, hash: "", onMore: () => {}, moreOpen: false }));

  it("shows Overview, Swap, Vault, Keys and a More button that controls the menu", () => {
    const m = html("/swap");
    for (const id of ["overview", "swap", "vault", "keys"]) expect(m).toContain(`data-testid="app-tab-${id}"`);
    expect(m).toContain('data-testid="app-burger"');
    expect(m).toContain('aria-controls="app-side"');
    expect(m).toContain('aria-expanded="false"');
    expect(m).toContain(">More<");
    expect(m.split("<a ").find((seg) => seg.includes('data-testid="app-tab-swap"'))!).toContain('aria-current="page"');
  });
});

describe("AppShell", () => {
  it("renders the top bar with the title, network pill and the account control, the sidebar and the page", () => {
    route.path = "/vault";
    const m = renderToStaticMarkup(withI18n(createElement(AppShell, null, createElement("p", null, "PAGE"))));
    expect(m).toContain('data-testid="app-shell"');
    expect(m).toContain('data-testid="app-title"');
    expect(m).toContain(">Vault<");
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

  it("the sidebar has a visible way back to the site, a proof link and the legal line", () => {
    route.path = "/keys";
    const m = renderToStaticMarkup(withI18n(createElement(AppShell, null, "x")));
    expect(m).toContain('data-testid="app-back"');
    expect(m).toContain("← Back to site");
    expect(m).toContain('data-testid="app-proof"');
    expect(m).toContain('href="/verify"');
    expect(m).toContain("Built on NEAR");
    expect(m.match(/data-testid="connect"/g)?.length).toBe(1);
  });

  it("the menu starts closed and the app footer is not rendered", () => {
    route.path = "/vault";
    const m = renderToStaticMarkup(withI18n(createElement(AppShell, null, "x")));
    expect(m).toMatch(/data-testid="app-burger"[^>]*aria-expanded="false"|aria-expanded="false"[^>]*data-testid="app-burger"/);
    expect(m).not.toMatch(/class="app-side open"/);
    expect(m).not.toContain("<footer");
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

  it("app routes get the shell and no site footer, and no public nav", () => {
    for (const p of ["/dashboard", "/swap", "/keys"]) {
      const m = render(p);
      expect(m, p).toContain('data-testid="app-shell"');
      expect(m, p).not.toContain('data-chrome="public"');
      expect(m, p).not.toContain('data-chrome="footer"');
      expect(m, p).toContain("BODY");
    }
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

  it("the public Nav has no wallet control; the account control keeps its test ids for the app bar", () => {
    const nav = src("../components/Nav.tsx");
    expect(nav).not.toContain("<AccountControl");
    expect(nav).toContain('testid="open-app"');
    expect(nav).toContain('"/dashboard"');
    expect(nav).not.toContain('data-testid="nav-more"');
    const acct = src("../components/AccountControl.tsx");
    expect(acct).toContain('data-testid="connect"');
    expect(acct).toContain('data-testid="account"');
    expect(acct).toContain('data-testid="account-menu"');
  });
});
