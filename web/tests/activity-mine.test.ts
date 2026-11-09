import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { HistEntry } from "@/lib/dashboard";
import { entryDetail, kindLabel } from "@/lib/dashboard";
import {
  bucketOf, chipOf, countsOf, defaultSourceOf, explorerHrefOf, historyRows, HISTORY_KINDS, metaOf, mineStateOf, mineWordOf, proofHrefOf,
  proofRowsOf, rawJsonOf, searchTextOf, subOf, summaryOf, timeOf, timelineOf, whereOf, type MineState, type OrderRow,
} from "@/components/activity/orders";
import { ActivityStats } from "@/components/activity/ActivityStats";
import { ActivityList } from "@/components/activity/ActivityList";
import { OrderDetails } from "@/components/activity/OrderDetails";
import { MineGate, type MineGateProps } from "@/components/activity/MineGate";
import { countsOf as countsFor } from "@/components/activity/orders";

const CALL = "call-abc-123";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
/* Entries as the worker's signed history returns them (oldest first, the way Overview reverses them). */
const ENTRIES: HistEntry[] = [
  { kind: "copy", ts_ms: 1_000, status: "success", amount: "1", token: USDC },
  { kind: "swap", ts_ms: 2_000, token_in: "nep141:wrap.near", token_out: USDC, amount_in: "1000000000000000000000000", amount_out: "2500000", status: "success" },
  { kind: "deposit", ts_ms: 3_000, token: USDC, amount: "5000000", status: "pending" },
  { kind: "withdraw", ts_ms: 2_500, token: "nep141:wrap.near", amount: "42", chain: "base", status: "refunded" },
  { kind: "swap", token_in: "nep141:wrap.near", token_out: USDC, amount_in: "1", amount_out: "0", status: "failed" },
];

const mine = () => historyRows(ENTRIES, CALL);

describe("historyRows: the holder's own trades, merged into the list", () => {
  it("merges swap, copy, withdraw and deposit entries; other kinds are not merged", () => {
    const rows = mine();
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.kind === "mine")).toBe(true);
    expect([...HISTORY_KINDS]).toEqual(["swap", "copy", "withdraw", "deposit"]);
    expect(historyRows([{ kind: "level_up", ts_ms: 5 } as HistEntry], CALL)).toEqual([]);
  });

  it("merges a copy trade as a Copy trade row, with the same status mapping as a swap", () => {
    const [copy] = historyRows([{ kind: "copy", ts_ms: 7_000, status: "success" } as HistEntry], CALL);
    expect(copy.title).toBe("Copy trade");
    expect(copy.title).toBe(kindLabel("copy"));
    expect(bucketOf(copy)).toBe("settled");
    expect(chipOf(copy).label).toBe("Settled");
    expect(proofHrefOf(copy)).toEqual({ href: `/verify?call=${CALL}`, internal: true });
    const failed = historyRows([{ kind: "copy", status: "failed" } as HistEntry], CALL)[0];
    expect(bucketOf(failed)).toBe("failed");
  });

  it("orders the newest first, with undated entries last", () => {
    const times = mine().map((r) => (r.read.state === "signed" ? r.read.entry.ts_ms ?? null : null));
    expect(times).toEqual([3_000, 2_500, 2_000, 1_000, null]);
  });

  it("keys every row by its call and index, so two entries never share a key", () => {
    const ids = mine().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith(`${CALL}:`)).toBe(true);
  });

  it("keeps the entry and the call it came from on each row, and titles it with the kind", () => {
    const deposit = mine()[0];
    expect(deposit.read).toMatchObject({ state: "signed", callId: CALL });
    expect(deposit.title).toBe(kindLabel("deposit"));
    expect(subOf(deposit)).toBe(entryDetail(ENTRIES[2]));
  });

  it("returns no rows without entries or without a call id (nothing is invented)", () => {
    expect(historyRows(null, CALL)).toEqual([]);
    expect(historyRows(undefined, CALL)).toEqual([]);
    expect(historyRows([], CALL)).toEqual([]);
    expect(historyRows(ENTRIES, null)).toEqual([]);
    expect(historyRows(ENTRIES, "")).toEqual([]);
  });
});

describe("the entry status maps to the same buckets as the public orders", () => {
  it.each([
    ["success", "settled", "Settled"],
    ["completed", "settled", "Completed"],
    ["refunded", "refunded", "Refunded"],
    ["failed", "failed", "Failed"],
    ["pending", "open", "Pending"],
    ["expired", "open", "Expired"],
    ["SUCCESS", "settled", "Settled"],
  ])("%s -> %s (%s)", (word, bucket, label) => {
    const e = { kind: "swap", status: word } as HistEntry;
    expect(mineWordOf(e)).toEqual({ bucket, label });
    const row = historyRows([e], CALL)[0];
    expect(bucketOf(row)).toBe(bucket);
    expect(chipOf(row).label).toBe(label);
  });

  it("a word the page does not know is not counted as any status", () => {
    const row = historyRows([{ kind: "swap", status: "mystery" } as HistEntry], CALL)[0];
    expect(bucketOf(row)).toBe("unread");
    expect(chipOf(row)).toEqual({ tone: "neutral", label: "mystery" });
  });

  it("an entry with no status says so, and prototype words are not statuses", () => {
    const none = historyRows([{ kind: "swap" } as HistEntry], CALL)[0];
    expect(chipOf(none).label).toBe("No status");
    expect(mineWordOf({ kind: "swap", status: "constructor" } as HistEntry)).toBeNull();
    expect(mineWordOf({ kind: "swap", status: "toString" } as HistEntry)).toBeNull();
  });

  it("counts the holder's rows like any others: settled, refunded, failed and open", () => {
    const c = countsOf(mine());
    expect(c).toMatchObject({ total: 5, read: 5, settled: 2, refunded: 1, failed: 1, open: 1, loading: 0, unavailable: 0 });
  });
});

describe("time, search, summary and the details links for a history row", () => {
  it("takes the time from the entry and formats it, or says none was recorded", () => {
    const rows = mine();
    expect(timeOf(rows[0])).toBe(3_000);
    expect(metaOf(rows[0])).not.toBe("");
    expect(timeOf(rows[3])).toBe(1_000);
    expect(timeOf(rows[4])).toBeNull();
    expect(metaOf(rows[4])).toBe("");
    expect(summaryOf(rows[4]).updated).toBe("Time not recorded");
    expect(summaryOf(rows[0]).updatedLabel).toBe("Time");
  });

  it("searches the token, the amount, the status word and the call id", () => {
    const deposit = mine()[0];
    expect(searchTextOf(deposit)).toContain(USDC.toLowerCase());
    expect(searchTextOf(deposit)).toContain("pending");
    expect(searchTextOf(deposit)).toContain(CALL);
    expect(searchTextOf(mine()[2])).toContain("2500000");
  });

  it("links the proof to the attested call, never to an explorer, and shows the call in the raw data", () => {
    const row = mine()[0];
    expect(proofHrefOf(row)).toEqual({ href: `/verify?call=${CALL}`, internal: true });
    expect(explorerHrefOf(row)).toBeNull();
    expect(proofRowsOf(row)).toEqual([{ label: "enclave call", value: CALL, href: `/verify?call=${CALL}`, internal: true }]);
    const raw = JSON.parse(rawJsonOf(row));
    expect(raw.callId).toBe(CALL);
    expect(raw.entry).toEqual(ENTRIES[2]);
  });

  it("says where the entry comes from and has no 1Click timeline to draw", () => {
    const row = mine()[0];
    expect(whereOf(row)).toMatch(/signed history/);
    expect(timelineOf(row).steps).toEqual([]);
  });
});

describe("mineStateOf: which state the Mine source is in (nothing is listed unless ready)", () => {
  const base = { signedIn: true, keysReady: true, hasKey: true, live: true, busy: false, read: true, failed: false, logOk: true as boolean | null };
  const at = (over: Partial<typeof base>): MineState => mineStateOf({ ...base, ...over });

  it("walks the states in order", () => {
    expect(at({ signedIn: false })).toBe("signed-out");
    expect(at({ keysReady: false })).toBe("keys-loading");
    expect(at({ hasKey: false })).toBe("no-key");
    expect(at({ live: false })).toBe("locked");
    expect(at({ busy: true, read: false })).toBe("reading");
    expect(at({ failed: true, read: false })).toBe("error");
    expect(at({ read: false })).toBe("reading");
    expect(at({ logOk: null })).toBe("checking");
    expect(at({ logOk: false })).toBe("unverified");
    expect(at({})).toBe("ready");
  });

  it("a failed log never reads as ready, and an unlocked session with no read yet is reading, not empty", () => {
    expect(at({ logOk: false, read: true })).toBe("unverified");
    expect(at({ read: false, logOk: null })).toBe("reading");
  });

  it("the default source is Mine only when the verified history has entries", () => {
    expect(defaultSourceOf(0)).toBe("public");
    expect(defaultSourceOf(3)).toBe("mine");
  });
});

describe("the Mine source renders honestly in each state", () => {
  const gate = (over: Partial<MineGateProps>) => renderToStaticMarkup(createElement(MineGate, {
    state: "locked", unlocking: false, unlockError: null, readError: null, onUnlock: () => {}, onConnect: () => {}, onRetry: () => {}, ...over,
  }));

  it("locked: the real unlock action, and the title says what it unlocks", () => {
    const m = gate({ state: "locked" });
    expect(m).toContain("Unlock to see your own trades");
    expect(m).toContain('data-testid="mine-unlock"');
    expect(m).toContain("Unlock session");
  });

  it("signed out: sign-in, not an unlock that cannot start", () => {
    const m = gate({ state: "signed-out" });
    expect(m).toContain('data-testid="mine-connect"');
    expect(m).not.toContain('data-testid="mine-unlock"');
  });

  it("no key: a link to mint one, with no figures", () => {
    const m = gate({ state: "no-key" });
    expect(m).toContain('href="/mint"');
    expect(m).not.toContain("Unlock to see");
  });

  it("error: says what failed and offers a retry", () => {
    const m = gate({ state: "error", readError: "Your trades could not be read." });
    expect(m).toContain("could not be read");
    expect(m).toContain('data-testid="mine-retry"');
  });

  it("unverified: says no entries are shown and none are counted, the same words Overview uses", () => {
    const m = gate({ state: "unverified" });
    expect(m).toContain("none are counted");
    expect(m).not.toContain('data-testid="mine-unlock"');
  });

  it("ready renders nothing", () => {
    expect(gate({ state: "ready" })).toBe("");
  });

  it("the stat tiles show dashes, not zeros, while Mine is not ready", () => {
    const m = renderToStaticMarkup(createElement(ActivityStats, { counts: countsFor([]), ready: false, notReadText: "Unlock to read" }));
    expect(m).toContain("—");
    expect(m).toContain("Unlock to read");
    expect(m).toContain('data-ready="0"');
    expect(m).not.toMatch(/data-value="0"/);
  });

  it("a ready Mine source with entries lists them with the Your vault tag", () => {
    const rows: OrderRow[] = mine();
    const m = renderToStaticMarkup(createElement(ActivityList, {
      items: rows, matched: rows.length, page: 1, pages: 1, selectedId: rows[0].id, onSelect: () => {}, onPage: () => {},
      query: "", onQuery: () => {}, empty: null, onClear: () => {},
    }));
    expect(m).toContain("Your vault");
    expect(m).toContain('data-kind="mine"');
  });

  it("the history details panel shows the entry, the verify link and the raw toggle", () => {
    const m = renderToStaticMarkup(createElement(OrderDetails, { row: mine()[0], onRetry: () => {} }));
    expect(m).toContain('data-testid="mine-details"');
    expect(m).toContain(`href="/verify?call=${CALL}"`);
    expect(m).toContain('data-testid="mine-verify"');
    expect(m).toContain('data-testid="act-raw-toggle"');
    expect(m).toContain("hidden");
  });
});

describe("the public orders are unchanged by the Mine source", () => {
  it("a public order keeps its own chip and no Your vault tag", () => {
    const pub: OrderRow = { id: "x", kind: "vault", title: "t", settlement: null, read: { state: "recorded" }, status: "SUCCESS", from: null, to: null };
    expect(chipOf(pub).label).toBe("Settled");
    const m = renderToStaticMarkup(createElement(ActivityList, {
      items: [pub], matched: 1, page: 1, pages: 1, selectedId: "x", onSelect: () => {}, onPage: () => {}, query: "", onQuery: () => {}, empty: null, onClear: () => {},
    }));
    expect(m).not.toContain("Your vault");
  });
});
