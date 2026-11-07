import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput, cleanAmount } from "@/components/ui/amount-input";
import { TokenSelect, filterTokens, type TokenOption } from "@/components/ui/token-select";
import { Modal, Sheet, trapIndex } from "@/components/ui/modal";
import { Tabs, nextTabIndex } from "@/components/ui/tabs";
import { Stepper } from "@/components/ui/stepper";
import { ToastList, ToastProvider, useToast, type ToastItem } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";
import { TxStatus } from "@/components/ui/tx-status";
import { TxResult } from "@/components/TxResult";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("Button v3", () => {
  it("has a danger variant with its own class", () => {
    const m = html(createElement(Button, { variant: "danger" }, "Delete key"));
    expect(m).toContain("kh-btn kh-btn--danger");
  });

  it("renders an icon before the label, hidden from assistive tech", () => {
    const m = html(createElement(Button, { icon: createElement("svg", null) }, "Swap"));
    expect(m).toContain('<span class="kh-btn-icon" aria-hidden="true"><svg></svg></span>');
    expect(m.indexOf("kh-btn-icon")).toBeLessThan(m.indexOf("kh-btn-label"));
  });

  it("hides the icon while loading (the spinner takes its place)", () => {
    const m = html(createElement(Button, { icon: createElement("svg", null), loading: true }, "Swap"));
    expect(m).not.toContain("kh-btn-icon");
    expect(m).toContain('class="spin"');
  });
});

describe("Input", () => {
  it("links the visible label to the field and prints the hint", () => {
    const m = html(createElement(Input, { id: "email", label: "Email", hint: "We send a code", name: "email" }));
    expect(m).toContain('<label for="email" class="kh-field-label">Email</label>');
    expect(m).toContain('id="email"');
    expect(m).toContain("We send a code");
    expect(m).not.toContain('aria-invalid="true"');
  });

  it("an error marks the field invalid, is announced and replaces the hint", () => {
    const m = html(createElement(Input, { id: "amt", label: "Amount", hint: "Whole numbers", error: "Enter an amount above 0" }));
    expect(m).toContain('aria-invalid="true"');
    expect(m).toContain('role="alert"');
    expect(m).toContain("Enter an amount above 0");
    expect(m).toContain('aria-describedby="amt-error"');
    expect(m).not.toContain("Whole numbers");
  });

  it("passes a test id through", () => {
    expect(html(createElement(Input, { id: "x", label: "X", testid: "field-x" }))).toContain('data-testid="field-x"');
  });
});

describe("AmountInput", () => {
  it("keeps a plain decimal and drops everything else", () => {
    expect(cleanAmount("1,250.5")).toBe("1.2505");
    expect(cleanAmount("12ab.3.4")).toBe("12.34");
    expect(cleanAmount("")).toBe("");
  });

  it("shows the symbol and a Max button only when a handler is given", () => {
    const withMax = html(createElement(AmountInput, { label: "You pay", value: "", onChange: () => {}, symbol: "USDC", onMax: () => {} }));
    expect(withMax).toContain("USDC");
    expect(withMax).toContain(">Max<");
    const without = html(createElement(AmountInput, { label: "You pay", value: "", onChange: () => {}, symbol: "USDC" }));
    expect(without).not.toContain(">Max<");
  });

  it("prints the balance and USD sub-line only when real figures are passed", () => {
    const m = html(createElement(AmountInput, { label: "You pay", value: "1", onChange: () => {}, symbol: "USDC", balance: "12.50 USDC", usd: "about $1.00" }));
    expect(m).toContain("Balance 12.50 USDC");
    expect(m).toContain("about $1.00");
    const bare = html(createElement(AmountInput, { label: "You pay", value: "", onChange: () => {}, symbol: "USDC" }));
    expect(bare).not.toContain("kh-amount-balance");
    expect(bare).not.toContain("kh-amount-usd");
  });

  it("an error is announced under the field and marks it invalid", () => {
    const m = html(createElement(AmountInput, { label: "You pay", value: "9", onChange: () => {}, symbol: "USDC", error: "More than your balance" }));
    expect(m).toContain('aria-invalid="true"');
    expect(m).toContain('role="alert"');
    expect(m).toContain("More than your balance");
  });
});

describe("TokenSelect", () => {
  const opts: TokenOption[] = [
    { id: "usdc", symbol: "USDC", name: "USD Coin", assetId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", balance: "12.50" },
    { id: "wnear", symbol: "wNEAR", name: "Wrapped NEAR", assetId: "nep141:wrap.near" },
    { id: "arb", symbol: "ETH", name: "Ether", chain: "Arbitrum" },
  ];

  it("filters by symbol, name and chain, case-insensitively; an empty query keeps everything", () => {
    expect(filterTokens(opts, "")).toHaveLength(3);
    expect(filterTokens(opts, "  usd ").map((o) => o.id)).toEqual(["usdc"]);
    expect(filterTokens(opts, "WRAPPED").map((o) => o.id)).toEqual(["wnear"]);
    expect(filterTokens(opts, "arbitrum").map((o) => o.id)).toEqual(["arb"]);
    expect(filterTokens(opts, "zzz")).toEqual([]);
  });

  it("the closed trigger shows the chosen token with its real mark and a dialog hint", () => {
    const m = html(createElement(TokenSelect, { label: "Pay with", options: opts, value: "usdc", onChange: () => {}, testid: "pay" }));
    expect(m).toContain('data-testid="pay"');
    expect(m).toContain('aria-haspopup="dialog"');
    expect(m).toContain('aria-expanded="false"');
    expect(m).toContain("USDC");
    expect(m).toContain('src="/tokens/usdc.svg"');
  });

  it("with nothing chosen the trigger says so", () => {
    expect(html(createElement(TokenSelect, { label: "Pay with", options: opts, value: null, onChange: () => {} }))).toContain("Choose a token");
  });
});

describe("Modal and Sheet", () => {
  it("renders nothing while closed", () => {
    expect(html(createElement(Modal, { open: false, onClose: () => {}, title: "Pick", children: "x" }))).toBe("");
  });

  it("when open: a labelled modal dialog with a close button", () => {
    const m = html(createElement(Modal, { open: true, onClose: () => {}, title: "Pick a token", children: createElement("p", null, "BODY") }));
    expect(m).toContain('role="dialog"');
    expect(m).toContain('aria-modal="true"');
    expect(m).toContain("Pick a token");
    expect(m).toContain('aria-label="Close"');
    expect(m).toContain("BODY");
    expect(m).toContain("kh-modal--dialog");
  });

  it("the sheet is the same dialog in the sheet shape", () => {
    const m = html(createElement(Sheet, { open: true, onClose: () => {}, title: "Deposit", children: "x" }));
    expect(m).toContain("kh-modal--sheet");
    expect(m).toContain('role="dialog"');
  });

  it("focus trap: Tab wraps from the last item to the first and Shift+Tab from the first to the last", () => {
    expect(trapIndex(2, 3, false)).toBe(0);
    expect(trapIndex(0, 3, true)).toBe(2);
    expect(trapIndex(1, 3, false)).toBeNull();
    expect(trapIndex(-1, 3, false)).toBe(0);
    expect(trapIndex(-1, 3, true)).toBe(2);
    expect(trapIndex(0, 0, false)).toBeNull();
  });
});

describe("Tabs", () => {
  const items = [{ id: "a", label: "Deposit" }, { id: "b", label: "Withdraw" }, { id: "c", label: "History" }];

  it("arrow keys, Home and End move between tabs and wrap at the ends", () => {
    expect(nextTabIndex(0, "ArrowRight", 3)).toBe(1);
    expect(nextTabIndex(2, "ArrowRight", 3)).toBe(0);
    expect(nextTabIndex(0, "ArrowLeft", 3)).toBe(2);
    expect(nextTabIndex(1, "End", 3)).toBe(2);
    expect(nextTabIndex(1, "Home", 3)).toBe(0);
    expect(nextTabIndex(1, "Enter", 3)).toBeNull();
    expect(nextTabIndex(0, "ArrowRight", 0)).toBeNull();
  });

  it("only the selected tab is in the tab order and says it is selected", () => {
    const m = html(createElement(Tabs, { items, value: "b", onChange: () => {}, label: "Vault actions", id: "vt" }));
    expect(m).toContain('role="tablist"');
    expect(m).toContain('aria-label="Vault actions"');
    const tabs = m.split('role="tab"').slice(1);
    expect(tabs).toHaveLength(3);
    expect(tabs[1]).toContain('aria-selected="true"');
    expect(tabs[1]).toContain('tabindex="0"');
    expect(tabs[0]).toContain('tabindex="-1"');
    expect(tabs[0]).toContain('aria-selected="false"');
  });
});

describe("Stepper", () => {
  it("marks the current step and prints each step's state in words", () => {
    const m = html(createElement(Stepper, { steps: [
      { label: "Connect", state: "done" },
      { label: "Get key", state: "current" },
      { label: "Review", state: "todo" },
    ], label: "Your key" }));
    expect(m).toContain('aria-label="Your key"');
    expect(m).toContain('aria-current="step"');
    expect(m.match(/aria-current="step"/g)).toHaveLength(1);
    expect(m).toContain(", done");
    expect(m).toContain(", current");
    expect(m).toContain(", to do");
    expect(m).toContain("✓");
  });
});

describe("Toast", () => {
  const items: ToastItem[] = [
    { id: 1, tone: "ok", title: "Key minted" },
    { id: 2, tone: "bad", title: "Swap refused", body: "Slippage was too high" },
  ];

  it("renders each toast in a polite status region with its tone and a labelled dismiss button", () => {
    const m = html(createElement(ToastList, { items, onDismiss: () => {} }));
    expect(m).toContain('role="status"');
    expect(m).toContain('aria-live="polite"');
    expect(m).toContain('data-tone="ok"');
    expect(m).toContain('data-tone="bad"');
    expect(m).toContain("Key minted");
    expect(m).toContain("Slippage was too high");
    expect(m).toContain('aria-label="Dismiss"');
    expect(m).toContain("Failed: ");
  });

  it("without a dismiss handler there is no close button", () => {
    expect(html(createElement(ToastList, { items: [items[0]] }))).not.toContain('aria-label="Dismiss"');
  });

  it("useToast works outside a provider (push does nothing and does not throw)", () => {
    function Probe() {
      const { push } = useToast();
      push({ tone: "info", title: "x" });
      return createElement("span", null, "ok");
    }
    expect(html(createElement(Probe))).toContain(">ok<");
  });

  it("the provider renders its children", () => {
    expect(html(createElement(ToastProvider, null, createElement("p", null, "APP")))).toContain("APP");
  });
});

describe("EmptyState", () => {
  it("prints a title, one sentence and an optional action; no art", () => {
    const m = html(createElement(EmptyState, { title: "No keys yet", body: "Mint one to start.", testid: "empty" }, createElement("a", { href: "/mint" }, "Mint a key")));
    expect(m).toContain('data-testid="empty"');
    expect(m).toContain("<h3>No keys yet</h3>");
    expect(m).toContain("Mint one to start.");
    expect(m).toContain("Mint a key");
    expect(m).not.toContain("<img");
  });
});

describe("TxStatus", () => {
  it("is the v3 name for the transaction result panel", () => {
    expect(TxStatus).toBe(TxResult);
    const m = html(createElement(TxStatus, { state: "pending" }));
    expect(m).toContain('data-state="pending"');
    expect(m).toContain("Waiting for the chain");
  });
});
