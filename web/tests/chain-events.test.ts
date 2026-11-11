import { describe, expect, it } from "vitest";
import { describeChainEvent, eventsForToken, parseKeyholeEvents, receiptToken } from "@/lib/chainEvents";

const TOKEN = "k5f4750858f328940";
const SALE = `EVENT_JSON:{"standard":"keyhole","version":"1.0.0","event":"key_sale","data":[{"token_id":"${TOKEN}","buyer":"3bde8ce5eb4e15403d49ba9512a98070db68958b39f378816f7862cee6168447","price":"100000000000000000000000","royalty":"5000000000000000000000","seller":"0705fdc1581a35351453bd4625f22d0c41b2b9edc3e7bed860586623c6778228"}]}`;
const OTHER = `EVENT_JSON:{"standard":"keyhole","version":"1.0.0","event":"key_list","data":[{"token_id":"kother","seller":"a.near","price":"1"}]}`;
const NEP = `EVENT_JSON:{"standard":"nep171","version":"1.0.0","event":"nft_transfer","data":[{"token_ids":["${TOKEN}"]}]}`;

describe("NEP-297 sale and loan events", () => {
  it("reads the token id from a receipt args string", () => {
    expect(receiptToken(JSON.stringify({ token_id: TOKEN }))).toBe(TOKEN);
    expect(receiptToken("not-json")).toBeNull();
    expect(receiptToken(null)).toBeNull();
  });
  it("keeps keyhole events for this token and drops other standards and tokens", () => {
    const rows = eventsForToken([
      { tx: "BbTs3JZaxdrgwPu6SjZQwjpuXk7wAxizeVqzKrS2pxNp", atMs: 20, logs: [SALE, OTHER, NEP, "not an event"] },
      { tx: "4kQnM9FjEKvXXEtenePc7LfdTtyLNbFirx5X8ytnvm1h", atMs: 10, logs: [`EVENT_JSON:{"standard":"keyhole","version":"1.0.0","event":"key_list","data":[{"token_id":"${TOKEN}","seller":"0705fdc1581a35351453bd4625f22d0c41b2b9edc3e7bed860586623c6778228","price":"100000000000000000000000"}]}`] },
    ], TOKEN);
    expect(rows.map((r) => r.event)).toEqual(["key_list", "key_sale"]);
    expect(parseKeyholeEvents([NEP])).toEqual([]);
    expect(describeChainEvent(rows[1]).title).toBe("Sold");
    expect(describeChainEvent(rows[1]).detail).toContain("0.1 NEAR");
  });
});
