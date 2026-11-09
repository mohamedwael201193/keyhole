import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildOrders, bucketOf, chipOf, countsOf, explorerFor, filterOrders, inRange, markOf, metaOf, pageNumbers, pageSlice, proofHrefOf,
  proofRowsOf, RANGES, rawJsonOf, refsOf, ROUTES, searchTextOf, shareText, shortHash, subOf, summaryOf, timelineOf, timeOf, whenLong,
  whenShort, whereOf, type LiveStatus, type OrderRead, type OrderRow,
} from "@/components/activity/orders";
import { ActivityStats } from "@/components/activity/ActivityStats";
import { OrderDetails } from "@/components/activity/OrderDetails";
import { OC_ASSETS } from "@/lib/oneclick";
import { SETTLEMENTS, VAULT_TRADE } from "@/lib/settlements";

/* Fixtures: the shapes of the real 1Click status payloads in docs/evidence/oneclick-sol (see route.ts for the normalised form). */
const A = SETTLEMENTS[0].depositAddress; // 0.03 wNEAR -> USDC on NEAR
const B = SETTLEMENTS[1].depositAddress; // under-deposit, refunded
const C = SETTLEMENTS[2].depositAddress; // 0.6 USDC on Base -> SOL
const D = SETTLEMENTS[3].depositAddress; // 0.004 SOL -> USDC on NEAR, settled
const E = SETTLEMENTS[4].depositAddress; // 0.001 SOL, refunded for NO_LIQUIDITY

const live = (status: string, over: Partial<LiveStatus["details"]> & { updatedAt?: string } = {}): OrderRead => {
  const { updatedAt = "2026-11-02T18:20:50.000Z", ...details } = over;
  return {
    state: "ok",
    live: {
      status,
      updatedAt,
      details: {
        depositedAmountFormatted: null, amountOutFormatted: null, refundedAmountFormatted: null,
        nearTxHashes: [], intentHashes: [], destinationChainTxHashes: [], originChainTxHashes: [], ...details,
      },
    },
  };
};
const SETTLED: OrderRead = live("SUCCESS", {
  amountOutFormatted: "0.367068", depositedAmountFormatted: "0.004",
  intentHashes: ["9H8uEEKhAuHwgKnjg2gfSKeiCjCZDE2d4k2SmgVmnRav"],
  nearTxHashes: ["EnsJbkGGdBgAKm7nitMYNW2HqybEYKpzt42FMkTWRthR", "8BQznSfbQUecDqCcEFwQj4vzr5x1X4rzLSLpszktf8fh"],
  destinationChainTxHashes: [{ hash: "8BQznSfbQUecDqCcEFwQj4vzr5x1X4rzLSLpszktf8fh", explorerUrl: "" }],
});
const REFUNDED: OrderRead = live("REFUNDED", {
  updatedAt: "2026-11-02T17:44:52.000Z", depositedAmountFormatted: "0.001", refundedAmountFormatted: "0.00089235",
  intentHashes: ["9whg63VDMGPPhuSBgCX1vK2FD877cpGT3th7ZqzUKY2d"],
});
const NO_INTENT_REFUND: OrderRead = live("REFUNDED", { refundedAmountFormatted: "0.02", updatedAt: "2026-11-02T10:00:00.000Z" });
const PROCESSING: OrderRead = live("PROCESSING", { depositedAmountFormatted: "0.6", intentHashes: ["Xr4TM3tEwfpwF9Hg2BcGJTH3uzZ7LroqBk9wgUnN1so"] });
const PENDING: OrderRead = live("PENDING_DEPOSIT", {});

const reads = (over: Record<string, OrderRead>): Record<string, OrderRead> => over;
const rowOf = (rows: OrderRow[], id: string) => rows.find((r) => r.id === id)!;

describe("buildOrders: the rows and their reads", () => {
  it("lists the recorded vault trade first, then every listed 1Click order, in the order the lib gives", () => {
    const rows = buildOrders({});
    expect(rows[0].kind).toBe("vault");
    expect(rows.slice(1).map((r) => r.id)).toEqual(SETTLEMENTS.map((s) => s.depositAddress));
  });

  it("an order with no read yet is loading, with no status", () => {
    const r = rowOf(buildOrders({}), A);
    expect(r.read.state).toBe("loading");
    expect(r.status).toBeNull();
    expect(bucketOf(r)).toBe("unread");
  });

  it("maps a documented status word to its row, and a word 1Click does not document to no status", () => {
    const rows = buildOrders(reads({ [A]: SETTLED, [B]: live("MYSTERY") }));
    expect(rowOf(rows, A).status).toBe("SUCCESS");
    expect(rowOf(rows, B).status).toBeNull();
    expect(chipOf(rowOf(rows, B))).toEqual({ tone: "neutral", label: "Not recognised" });
  });

  it("the vault trade is settled by its recorded evidence, not by a live read", () => {
    const v = buildOrders({})[0];
    expect(v.status).toBe("SUCCESS");
    expect(v.read.state).toBe("recorded");
    expect(timeOf(v)).toBeNull();
  });

  it("every order has its from and to asset in the 1Click list (a renamed asset cannot drop a token mark)", () => {
    const ids = new Set<string>(OC_ASSETS.map((a) => a.id));
    for (const r of Object.values(ROUTES)) {
      expect(ids.has(r.from), r.from).toBe(true);
      expect(ids.has(r.to), r.to).toBe(true);
    }
    for (const r of buildOrders({})) {
      expect(r.from, r.id).not.toBeNull();
      expect(r.to, r.id).not.toBeNull();
    }
  });
});

describe("countsOf: counts from the real rows, never from a guess", () => {
  it("a loading or unreadable order is not counted as any status", () => {
    const rows = buildOrders(reads({ [A]: SETTLED, [B]: { state: "error" } }));
    const c = countsOf(rows);
    expect(c.total).toBe(6);
    expect(c.loading).toBe(3);
    expect(c.unavailable).toBe(1);
    expect(c.read).toBe(2); // the vault trade (recorded) and A
    expect(c.settled).toBe(2);
    expect(c.refunded).toBe(0);
    expect(c.failed).toBe(0);
  });

  it("counts each status once, and open statuses separately", () => {
    const rows = buildOrders(reads({ [A]: SETTLED, [B]: REFUNDED, [C]: PROCESSING, [D]: SETTLED, [E]: REFUNDED }));
    const c = countsOf(rows);
    expect(c).toMatchObject({ total: 6, read: 6, settled: 3, refunded: 2, failed: 0, open: 1, loading: 0, unavailable: 0 });
    expect(c.settled + c.refunded + c.failed + c.open).toBe(c.read);
  });

  it("a failed status is counted under failed only", () => {
    const rows = buildOrders(reads({ [A]: live("FAILED") }));
    expect(countsOf(rows).failed).toBe(1);
    expect(countsOf(rows).refunded).toBe(0);
  });

  it("the recorded example of a failed order is not an order: it is not in the rows at all", () => {
    expect(buildOrders({}).some((r) => r.status === "FAILED")).toBe(false);
  });
});

describe("shares: computed over the read orders, or not shown", () => {
  it("is a percentage of the read orders, to one decimal, with no trailing .0", () => {
    expect(shareText(18, 24)).toBe("75%");
    expect(shareText(4, 24)).toBe("16.7%");
    expect(shareText(2, 24)).toBe("8.3%");
    expect(shareText(1, 3)).toBe("33.3%");
    expect(shareText(0, 5)).toBe("0%");
  });
  it("is null before any order is read, so the page says so instead of 0%", () => {
    expect(shareText(0, 0)).toBeNull();
  });
});

describe("the stat tiles state what is not read", () => {
  const html = (rows: OrderRow[]) => renderToStaticMarkup(createElement(ActivityStats, { counts: countsOf(rows) }));
  it("says Not read yet for every share while no listed order is read, and names the orders still reading", () => {
    const m = html(buildOrders({}).slice(1)); // the five listed orders, none read
    expect(m).toContain("Not read yet");
    expect(m).toMatch(/data-testid="act-stat-total"[\s\S]*?5 reading live/);
  });
  it("shows the real share once reads land (the recorded vault trade is a known status and counts), and no trend", () => {
    const m = html(buildOrders(reads({ [A]: SETTLED, [B]: REFUNDED })));
    expect(m).toContain("66.7% success rate"); // 2 settled (vault and A) of 3 known
    expect(m).toContain("33.3% of read orders"); // 1 refunded (B) of 3 known
    expect(m).not.toMatch(/\+\d+%/);
  });
});

describe("filters, date range and search", () => {
  const now = Date.parse("2026-11-03T12:00:00.000Z");
  const rows = buildOrders(reads({ [A]: SETTLED, [B]: REFUNDED, [C]: NO_INTENT_REFUND, [D]: { state: "error" } }));

  it("filters by status", () => {
    expect(filterOrders(rows, { filter: "settled", range: "all", text: "", now }).map((r) => r.id)).toEqual([VAULT_TRADE.callId, A]);
    expect(filterOrders(rows, { filter: "refunded", range: "all", text: "", now }).map((r) => r.id)).toEqual([B, C]);
    expect(filterOrders(rows, { filter: "failed", range: "all", text: "", now })).toEqual([]);
    expect(filterOrders(rows, { filter: "all", range: "all", text: "", now })).toHaveLength(rows.length);
  });

  it("a bounded date range leaves out an order with no readable time, and keeps the ones inside it", () => {
    const within = filterOrders(rows, { filter: "all", range: "7d", text: "", now }).map((r) => r.id);
    expect(within).toContain(A);
    expect(within).toContain(B);
    expect(within).not.toContain(D); // loading: no time
    expect(within).not.toContain(VAULT_TRADE.callId); // recorded: no time
  });

  it("a 24 hour range drops orders older than a day", () => {
    const r = rowOf(rows, B); // 2026-11-02T17:44Z
    const later = Date.parse("2026-11-04T00:00:00.000Z");
    expect(inRange(r, "1d", later)).toBe(false);
    expect(inRange(r, "1d", now)).toBe(true);
    expect(inRange(r, "7d", now)).toBe(true);
    expect(inRange(r, "all", now)).toBe(true);
  });

  it("searches the tx, the token, the amount and the status word, case-insensitively", () => {
    const q = (text: string) => filterOrders(rows, { filter: "all", range: "all", text, now }).map((r) => r.id);
    expect(q("8BQznSfbQUecDqCcEFwQj4vzr5x1X4rzLSLpszktf8fh")).toEqual([A]);
    // B's live refund and E's recorded quote ("0.00089235 SOL returned") both carry this amount.
    expect(q("  0.00089235 ")).toEqual([B, E]);
    // Search reads the text, so the title of E ("... refunded for NO_LIQUIDITY") matches too; the Refunded filter uses the status.
    expect(q("REFUNDED")).toEqual([B, C, E]);
    expect(filterOrders(rows, { filter: "refunded", range: "all", text: "", now }).map((r) => r.id)).toEqual([B, C]);
    expect(q("sol")).toContain(D);
    expect(q("zzz-no-match")).toEqual([]);
  });

  it("search text includes the real hashes of the order and the recorded vault intent", () => {
    expect(searchTextOf(rowOf(rows, A))).toContain("9H8uEEKhAuHwgKnjg2gfSKeiCjCZDE2d4k2SmgVmnRav".toLowerCase());
    expect(searchTextOf(buildOrders({})[0])).toContain(VAULT_TRADE.intentHash.toLowerCase());
  });
});

describe("pages of five", () => {
  it("slices five rows a page and clamps the page number", () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    expect(pageSlice(items, 1)).toMatchObject({ page: 1, pages: 3, total: 12 });
    expect(pageSlice(items, 1).items).toEqual([0, 1, 2, 3, 4]);
    expect(pageSlice(items, 3).items).toEqual([10, 11]);
    expect(pageSlice(items, 9).page).toBe(3);
    expect(pageSlice(items, 0).page).toBe(1);
    expect(pageSlice([], 1)).toMatchObject({ pages: 1, items: [] });
  });
  it("shows every page up to seven, then first, last and the neighbours of the current page", () => {
    expect(pageNumbers(2, 4)).toEqual([1, 2, 3, 4]);
    expect(pageNumbers(1, 9)).toEqual([1, 2, "gap", 9]);
    expect(pageNumbers(5, 9)).toEqual([1, "gap", 4, 5, 6, "gap", 9]);
  });
  it("the page size of the list is five (the plan's rule)", () => {
    const rows = buildOrders({});
    expect(pageSlice(rows, 1).items).toHaveLength(5);
  });
});

describe("the timeline follows the real status and the real hashes", () => {
  it("a settled order: deposit done, intent done with its hash, settled with the destination hash and the received amount", () => {
    const t = timelineOf(rowOf(buildOrders(reads({ [D]: SETTLED })), D));
    expect(t.step).toBe(3);
    expect(t.refund).toBe(false);
    expect(t.steps.map((s) => s.state)).toEqual(["done", "done", "done"]);
    expect(t.steps[1].links[0].href).toBe("https://explorer.near-intents.org/transactions/9H8uEEKhAuHwgKnjg2gfSKeiCjCZDE2d4k2SmgVmnRav");
    expect(t.steps[2].amount).toBe("0.367068 USDC");
    expect(t.steps[2].links[0].hash).toBe("8BQznSfbQUecDqCcEFwQj4vzr5x1X4rzLSLpszktf8fh");
  });

  it("a refunded order with an intent: the refund is the last step, and the intent step is done, not skipped", () => {
    const t = timelineOf(rowOf(buildOrders(reads({ [E]: REFUNDED })), E));
    expect(t.refund).toBe(true);
    expect(t.steps[1].state).toBe("done");
    expect(t.steps[2].title).toBe("Refunded to sender");
    expect(t.steps[2].amount).toBe("0.00089235 SOL");
  });

  it("a refund with no intent hash marks the intent step as not reached, and never invents a hash", () => {
    const t = timelineOf(rowOf(buildOrders(reads({ [B]: NO_INTENT_REFUND })), B));
    expect(t.steps[1].state).toBe("skipped");
    expect(t.steps[1].links).toEqual([]);
    expect(t.steps[1].sub).toBe("No intent hash came back for this order.");
  });

  it("a deposit still waiting is current; a route still running is current on the intent", () => {
    expect(timelineOf(rowOf(buildOrders(reads({ [B]: PENDING })), B)).steps[0].state).toBe("current");
    const p = timelineOf(rowOf(buildOrders(reads({ [C]: PROCESSING })), C));
    expect(p.steps.map((s) => s.state)).toEqual(["done", "current", "todo"]);
    expect(p.steps[1].links[0].href).toContain("Xr4TM3tEwfpwF9Hg2BcGJTH3uzZ7LroqBk9wgUnN1so");
  });

  it("an order still loading shows every step as waiting and the step as -1 (not read)", () => {
    const t = timelineOf(rowOf(buildOrders({}), A));
    expect(t.step).toBe(-1);
    expect(t.steps.map((s) => s.state)).toEqual(["todo", "todo", "todo"]);
  });

  it("the vault trade is settled from its record, with its intent link", () => {
    const t = timelineOf(buildOrders({})[0]);
    expect(t.steps.every((s) => s.state === "done")).toBe(true);
    expect(t.steps[1].links[0].href).toBe(`https://explorer.near-intents.org/transactions/${VAULT_TRADE.intentHash}`);
    expect(t.steps[2].amount).toBe(VAULT_TRADE.amountOut);
  });
});

describe("the summary and the rows say what was read", () => {
  it("received and the last update are the real read; a loading order says it is reading", () => {
    const rows = buildOrders(reads({ [D]: SETTLED }));
    expect(summaryOf(rowOf(rows, D))).toMatchObject({ received: "0.367068 USDC", updatedLabel: "Last update" });
    expect(summaryOf(rowOf(rows, A)).received).toBe("Reading the live status");
    expect(summaryOf(rowOf(rows, A)).updated).toBe("Reading");
  });
  it("a refunded order says what was refunded, and a settled one its received amount in the row sub line", () => {
    const rows = buildOrders(reads({ [B]: NO_INTENT_REFUND, [D]: SETTLED }));
    expect(subOf(rowOf(rows, B))).toBe("0.02 USDC returned");
    expect(subOf(rowOf(rows, D))).toBe("0.367068 USDC received");
    expect(summaryOf(rowOf(rows, B)).received).toBe("None. 0.02 USDC was refunded.");
  });
  it("an unread order names what it is doing, never a status", () => {
    const rows = buildOrders(reads({ [A]: { state: "error" } }));
    expect(subOf(rowOf(rows, A))).toMatch(/unavailable/i);
    expect(chipOf(rowOf(rows, A)).label).toBe("Not read");
    expect(chipOf(rowOf(buildOrders({}), A)).label).toBe("Checking");
    expect(markOf(rowOf(rows, A)).icon).toBe("alert");
  });
  it("the meta line is the real read time, Recorded for the vault trade, and empty while unread", () => {
    const rows = buildOrders(reads({ [D]: SETTLED }));
    expect(metaOf(rowOf(rows, D))).toBe(whenShort("2026-11-02T18:20:50.000Z"));
    expect(metaOf(rows[0])).toBe("Recorded");
    expect(metaOf(rowOf(rows, A))).toBe("");
  });
  it("where the funds are comes from the 1Click explanation, and says so when not read", () => {
    expect(whereOf(rowOf(buildOrders(reads({ [D]: SETTLED })), D))).toBe("Funds arrived at the recipient.");
    expect(whereOf(rowOf(buildOrders({}), A))).toMatch(/Reading the live status/);
  });
});

describe("proof and links", () => {
  it("every explorer link is an https link built from a real hash, and the list has no duplicate keys", () => {
    const rows = buildOrders(reads({ [D]: SETTLED, [C]: PROCESSING }));
    for (const r of rows) {
      const items = proofRowsOf(r);
      const keys = items.map((i) => `${i.label}|${i.value}`);
      expect(new Set(keys).size, r.id).toBe(keys.length);
      for (const i of items) if (i.href && !i.internal) expect(i.href.startsWith("https://"), i.href).toBe(true);
    }
  });
  it("View proof goes to the intent first, and the vault trade to its enclave call", () => {
    expect(proofHrefOf(rowOf(buildOrders(reads({ [C]: PROCESSING })), C))).toEqual({
      href: `https://explorer.near-intents.org/transactions/Xr4TM3tEwfpwF9Hg2BcGJTH3uzZ7LroqBk9wgUnN1so`, internal: false,
    });
    expect(proofHrefOf(buildOrders({})[0])).toEqual({ href: `/verify?call=${VAULT_TRADE.callId}`, internal: true });
  });
  it("refsOf keeps only hashes, and only https explorer links (no javascript: or other schemes)", () => {
    expect(refsOf(["abc", { hash: "def", explorerUrl: "https://solscan.io/tx/def" }, { hash: "ghi", explorerUrl: "javascript:alert(1)" }, 7, null, { hash: "" }])).toEqual([
      { hash: "abc", explorerUrl: null },
      { hash: "def", explorerUrl: "https://solscan.io/tx/def" },
      { hash: "ghi", explorerUrl: null },
    ]);
    expect(refsOf("not a list")).toEqual([]);
  });
  it("explorerFor only links chains it knows, with a well-formed hash", () => {
    expect(explorerFor("near", "BGyVQcr6pb1WpAFQJJCRUUoa5YgbdcgQkpC11KvyKgRd")).toBe("https://nearblocks.io/txns/BGyVQcr6pb1WpAFQJJCRUUoa5YgbdcgQkpC11KvyKgRd");
    expect(explorerFor("base", "not-hex")).toBeNull();
    expect(explorerFor("eth", "0x" + "a".repeat(64))).toBeNull();
    expect(explorerFor("base", "0x" + "a".repeat(64))).toBe(`https://basescan.org/tx/0x${"a".repeat(64)}`);
  });
});

describe("raw data is the payload the page read", () => {
  it("is the live read as received, with the deposit address; a loading order shows no status", () => {
    const rows = buildOrders(reads({ [D]: SETTLED }));
    const j = JSON.parse(rawJsonOf(rowOf(rows, D)));
    expect(j.depositAddress).toBe(D);
    expect(j.status).toBe("SUCCESS");
    expect(j.details.amountOutFormatted).toBe("0.367068");
    expect(JSON.parse(rawJsonOf(rowOf(buildOrders({}), D))).status).toBeNull();
  });
});

describe("time and text helpers", () => {
  it("shows the times in UTC+2, the way the mockups do", () => {
    expect(whenLong("2026-11-02T18:20:50.000Z")).toMatch(/2 Nov 2026, 20:20 \(UTC\+2\)/);
    expect(whenShort("2026-11-02T18:20:50.000Z")).toBe("2 Nov, 20:20");
  });
  it("shortens a hash to its first eight and last four characters", () => {
    expect(shortHash("abcdefghijklmnop")).toBe("abcdefgh…mnop");
    expect(shortHash("short")).toBe("short");
  });
  it("ranges are the four the page offers, and the default is all time", () => {
    expect(RANGES.map((r) => r.id)).toEqual(["all", "1d", "7d", "30d"]);
    expect(RANGES[0].label).toBe("All time");
  });
});

describe("the details panel renders the order and its states", () => {
  const html = (row: OrderRow) => renderToStaticMarkup(createElement(OrderDetails, { row, onRetry: () => {} }));
  it("a settled order shows its timeline, its explorer link and the hashes", () => {
    const m = html(rowOf(buildOrders(reads({ [D]: SETTLED })), D));
    expect(m).toContain('data-testid="funds-path"');
    expect(m).toContain('data-step="3"');
    expect(m).toContain('data-testid="st-updated"');
    expect(m).toContain('data-testid="act-view-proof"');
    expect(m).toContain('data-testid="act-raw"');
    expect(m).toContain("hidden");
  });
  it("an order still loading says so, and has no received amount or update time", () => {
    const m = html(rowOf(buildOrders({}), A));
    expect(m).toContain("Reading the live status");
    expect(m).not.toContain('data-testid="st-updated"');
    expect(m).toContain('data-step="-1"');
  });
  it("an unreadable order offers a retry, and names the failure", () => {
    const m = html(rowOf(buildOrders(reads({ [A]: { state: "error" } })), A));
    expect(m).toContain('data-testid="act-retry"');
    expect(m).toContain("could not be read");
  });
  it("the vault trade keeps its testids and its verify link", () => {
    const m = html(buildOrders({})[0]);
    expect(m).toContain('data-testid="vault-trade"');
    expect(m).toContain('data-testid="vault-trade-verify"');
    expect(m).toContain(`/verify?call=${VAULT_TRADE.callId}`);
    expect(m).toContain(VAULT_TRADE.intentHash);
  });
});

describe("bucket and count consistency", () => {
  it("bucketOf agrees with countsOf for every row", () => {
    const rows = buildOrders(reads({ [A]: SETTLED, [B]: REFUNDED, [C]: PROCESSING, [D]: { state: "error" }, [E]: PENDING }));
    const c = countsOf(rows);
    const by = (b: string) => rows.filter((r) => bucketOf(r) === b).length;
    expect(by("settled")).toBe(c.settled);
    expect(by("refunded")).toBe(c.refunded);
    expect(by("open")).toBe(c.open);
    expect(by("unread")).toBe(c.loading + c.unavailable);
  });
});
