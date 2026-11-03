import { describe, expect, it } from "vitest";
import { KEY_ID } from "@/app/key/view";
import { acctAlt, tx, txAlt } from "@/lib/config";
import { shortKeyId } from "@/lib/near";
import { translate } from "@/lib/i18n";

describe("key ids", () => {
  for (const id of ["0", "1", "42", "k102a806df6867547", "k5f4750858f328940"]) it(`accepts ${id}`, () => expect(KEY_ID.test(id)).toBe(true));
  for (const id of ["", "k", "k12", "abc", "-1", "1.5", "k12 34", "<script>", "k" + "a".repeat(40), "1".repeat(10)]) it(`rejects ${JSON.stringify(id)}`, () => expect(KEY_ID.test(id)).toBe(false));
});

describe("one key name everywhere", () => {
  const name = (id: string) => translate("gallery.key", { id: shortKeyId(id) });
  it("gallery and vault agree for k102a806df6867547", () => expect(name("k102a806df6867547")).toBe("KEYHOLE Key #102a"));
  it("numeric ids keep their number", () => expect(name("0")).toBe("KEYHOLE Key #0"));
  it("short k id keeps its core", () => expect(name("k1234")).toBe("KEYHOLE Key #1234"));
});

describe("fallback explorer", () => {
  const h = "GNqXiicFgXQpS5LsYiNRffK6Xhp5W7Yi8EZK2XqKvX8X";
  it("tx alt link", () => expect(txAlt(h)).toBe(`https://pikespeak.ai/transaction-viewer/${h}`));
  it("account alt link", () => expect(acctAlt("keyhole-devmo.near")).toBe("https://pikespeak.ai/wallet-explorer/keyhole-devmo.near"));
  it("alt differs from main host", () => expect(new URL(txAlt(h)).host).not.toBe(new URL(tx(h)).host));
});

import { ethMismatch } from "@/lib/wallet";
describe("MetaMask account mismatch", () => {
  const a = "0xf76e000000000000000000000000000000071a3a";
  const b = "0x1111111111111111111111111111111111111111";
  it("same account, any case: no mismatch", () => expect(ethMismatch(a, [a.toUpperCase().replace("0X", "0x")])).toBeNull());
  it("different account is reported", () => expect(ethMismatch(a, [b])).toBe(b));
  it("locked MetaMask (no accounts) is not a mismatch", () => expect(ethMismatch(a, [])).toBeNull());
  it("NEAR account ids are never compared", () => expect(ethMismatch("alice.near", [b])).toBeNull());
  it("garbage from the provider is ignored", () => expect(ethMismatch(a, ["nope"])).toBeNull());
  it("non-array is ignored", () => expect(ethMismatch(a, null)).toBeNull());
});
