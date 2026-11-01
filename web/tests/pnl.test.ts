import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { decodeShare, encodeShare, parseStatement, sigValid, usd } from "@/lib/pnl";

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

describe("public PnL statement", () => {
  const sk = new Uint8Array(32).fill(7);
  const pk = hex(ed25519.getPublicKey(sk));
  const statement = '{"cost_usd_micro":30000,"kind":"keyhole-pnl-v1","log_head":"00","method":"m","owner":"bob.near","pnl_usd_micro":-5000,"since_ms":1,"token_id":"kabc","trades":2,"ts_ms":9,"value_now_usd_micro":25000}';
  const sig = hex(ed25519.sign(new TextEncoder().encode(statement), sk));
  it("round-trips through the share link and verifies", () => {
    const s = decodeShare(encodeShare({ statement, sig, minter: pk, call_id: "c1" }))!;
    expect(sigValid(s)).toBe(true);
    expect(parseStatement(s.statement)?.pnl_usd_micro).toBe(-5000);
  });
  it("an edited number fails the signature", () => {
    expect(sigValid({ statement: statement.replace("-5000", "5000"), sig, minter: pk, call_id: null })).toBe(false);
  });
  it("formats signed dollars", () => { expect(usd(-5000)).toBe("−$0.0050"); expect(usd(1_230_000)).toBe("$1.23"); });
});
