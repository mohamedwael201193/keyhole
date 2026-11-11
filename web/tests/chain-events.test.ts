import { describe, expect, it } from "vitest";
import {
  EVENT_PAGE_SIZE,
  authenticatedLogs,
  describeChainEvent,
  eventsForToken,
  pageStep,
  parseKeyholeEvents,
  chainEventView,
  classifyTokenArg,
  receiptToken,
  type IndexedEvent,
} from "@/lib/chainEvents";

const CONTRACT = "keyhole-devmo.near";
const TOKEN = "k5f4750858f328940";
const TX = "BbTs3JZaxdrgwPu6SjZQwjpuXk7wAxizeVqzKrS2pxNp";
const sale = (version: string | null = "1.0.0") =>
  `EVENT_JSON:${JSON.stringify({
    standard: "keyhole",
    ...(version == null ? {} : { version }),
    event: "key_sale",
    data: [{ token_id: TOKEN, seller: "0705fdc1581a35351453bd4625f22d0c41b2b9edc3e7bed860586623c6778228", buyer: "3bde8ce5eb4e15403d49ba9512a98070db68958b39f378816f7862cee6168447", price: "100000000000000000000000", royalty: "5000000000000000000000" }],
  })}`;

function outcome(executor: string, status: unknown, logs: string[]) {
  return { outcome: { executor_id: executor, status, logs } };
}

function tx(outcomes: unknown[], final = "FINAL") {
  return { final_execution_status: final, receipts_outcome: outcomes };
}

const ok = { SuccessValue: "" };

describe("authenticated receipt logs", () => {
  it("keeps a successful contract receipt when a later child fails", () => {
    const logs = authenticatedLogs(tx([
      outcome(CONTRACT, ok, [sale()]),
      outcome(CONTRACT, { Failure: { ActionError: {} } }, [sale()]),
    ]), CONTRACT);
    expect(logs.final).toBe(true);
    expect(eventsForToken([{ tx: TX, atMs: 1, logs: logs.logs }], TOKEN)).toHaveLength(1);
  });
  it("drops a foreign executor and a failed contract receipt", () => {
    const foreign = authenticatedLogs(tx([outcome("other.near", ok, [sale()])]), CONTRACT);
    const failed = authenticatedLogs(tx([outcome(CONTRACT, { Failure: {} }, [sale()])]), CONTRACT);
    expect(eventsForToken([{ tx: TX, atMs: 1, logs: foreign.logs }], TOKEN)).toEqual([]);
    expect(eventsForToken([{ tx: TX, atMs: 1, logs: failed.logs }], TOKEN)).toEqual([]);
  });
  it("refuses a transaction that is not final", () => {
    expect(authenticatedLogs(tx([outcome(CONTRACT, ok, [sale()])], "EXECUTED_OPTIMISTIC"), CONTRACT).final).toBe(false);
  });
});

describe("NEP-297 schema", () => {
  it("accepts keyhole 1.0.0 with the required sale fields", () => {
    const rows = eventsForToken([{ tx: TX, atMs: 1, logs: [sale()] }], TOKEN);
    expect(rows).toHaveLength(1);
    expect(describeChainEvent(rows[0])?.title).toBe("Sold");
    expect(describeChainEvent(rows[0])?.detail).toContain("0.1 NEAR");
  });
  it("rejects a wrong version, a missing version, a wrong standard, and a missing field", () => {
    expect(parseKeyholeEvents([sale("99.0.0")])).toEqual([]);
    expect(parseKeyholeEvents([sale(null)])).toEqual([]);
    expect(parseKeyholeEvents([`EVENT_JSON:{"standard":"nep171","version":"1.0.0","event":"nft_transfer","data":[{"token_ids":["${TOKEN}"]}]}`])).toEqual([]);
    const thin = sale().replace('"royalty":"5000000000000000000000"', '"royalty":""');
    expect(parseKeyholeEvents([thin])).toEqual([]);
    expect(describeChainEvent({ event: "not_a_kind", standard: "keyhole", version: "1.0.0", tx: TX, atMs: 1, data: { token_id: TOKEN } })).toBeNull();
  });
  it("reads a token id from receipt args", () => {
    expect(receiptToken(JSON.stringify({ token_id: TOKEN }))).toBe(TOKEN);
    expect(receiptToken(Buffer.from(JSON.stringify({ token_id: TOKEN })).toString("base64"))).toBe(TOKEN);
    expect(receiptToken("not-json")).toBeNull();
    expect(classifyTokenArg(JSON.stringify({ token_id: "kother" }), TOKEN)).toBe("other");
    expect(classifyTokenArg(42, TOKEN)).toBe("unreadable");
    expect(classifyTokenArg("not-json-or-base64", TOKEN)).toBe("unreadable");
    expect(classifyTokenArg({}, TOKEN)).toBe("unreadable");
  });
  it("shows unavailable rather than an empty history when the read is not complete", () => {
    expect(chainEventView({ ok: false, complete: false, events: [] }).state).toBe("unavailable");
    expect(chainEventView({ ok: true, complete: true, events: [] }).state).toBe("ready");
  });
});

describe("bounded pages", () => {
  it("continues while a full page still has a cursor, and stops incomplete at the bound", () => {
    const full = { txns: Array.from({ length: EVENT_PAGE_SIZE }, (_, i) => i), cursor: "next" };
    expect(pageStep(full, 0, 2)).toEqual({ stop: false, complete: false, cursor: "next" });
    expect(pageStep(full, 1, 2).complete).toBe(false);
    expect(pageStep({ txns: [1], cursor: "next" }, 0).complete).toBe(true);
  });
  it("discovers a principal delivery by event, not by a token argument", () => {
    const line = `EVENT_JSON:${JSON.stringify({ standard: "keyhole", version: "1.0.0", event: "loan_principal_delivered", data: [{ token_id: TOKEN, nonce: "1", payout_nonce: "4" }] })}`;
    const row = eventsForToken([{ tx: "claim", atMs: 2, logs: [line] }], TOKEN)[0] as IndexedEvent;
    expect(row.event).toBe("loan_principal_delivered");
    expect(describeChainEvent(row)?.title).toBe("Principal delivered");
  });
});
