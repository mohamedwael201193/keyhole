// Key sale transactions: the gas pins, the action building, each wallet route and the typed errors.
import { describe, expect, it } from "vitest";
import {
  GAS_BUY, GAS_BUY_TGAS, GAS_LIST, GAS_LIST_TGAS, ONE_YOCTO, classifyTxError, classifyTxText, functionCallAction, outcomeFailure,
  outcomeHash, panicText, sendKeysCall, type KeysCall, type TxRoute, type TxWallet,
} from "@/lib/keysTx";

const LIST: KeysCall = { method: "nft_list", args: { token_id: "k1", price: "5000000000000000000000000" }, deposit: "10000000000000000000000", gas: GAS_LIST };
const BUY: KeysCall = { method: "nft_buy", args: { token_id: "k1" }, deposit: "5000000000000000000000000", gas: GAS_BUY };

/** A fake wallet that records what it was asked to sign and answers with `result`. */
function fakeWallet(result: unknown | (() => unknown)) {
  const calls: { params: Record<string, unknown> }[] = [];
  const wallet: TxWallet = {
    async signAndSendTransaction(params) {
      calls.push({ params });
      return typeof result === "function" ? (result as () => unknown)() : result;
    },
  };
  return { wallet, calls };
}

const OK = { transaction: { hash: "HASH123" }, status: { SuccessValue: "" } };
const PANIC = {
  transaction: { hash: "H2" },
  status: { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: one key per account: receiver already holds a KEYHOLE key" } } } } },
};

describe("gas for the sale calls (measured on a mainnet-state fork)", () => {
  it("nft_buy gets 50 TGas: it burns about 13 TGas and fails with 10 TGas attached", () => {
    expect(GAS_BUY_TGAS).toBe(50);
    expect(GAS_BUY).toBe("50000000000000");
    expect(Number(GAS_BUY)).toBeGreaterThanOrEqual(50 * 10 ** 12);
  });
  it("nft_list and nft_unlist get 30 TGas", () => {
    expect(GAS_LIST_TGAS).toBe(30);
    expect(GAS_LIST).toBe("30000000000000");
  });
  it("one yoctoNEAR is the string '1'", () => { expect(ONE_YOCTO).toBe("1"); });
});

describe("functionCallAction", () => {
  it("builds the selector FunctionCall shape with the method, args, gas and deposit", () => {
    expect(functionCallAction(BUY)).toEqual({
      type: "FunctionCall",
      params: { methodName: "nft_buy", args: { token_id: "k1" }, gas: GAS_BUY, deposit: "5000000000000000000000000" },
    });
  });
  it("refuses a deposit or gas that is not a decimal string, a bad method name, or args that are not an object", () => {
    expect(() => functionCallAction({ ...BUY, deposit: "0.5" })).toThrow(/deposit/);
    expect(() => functionCallAction({ ...BUY, gas: "" })).toThrow(/gas/);
    expect(() => functionCallAction({ ...BUY, gas: "50 TGas" })).toThrow(/gas/);
    expect(() => functionCallAction({ ...BUY, method: "nft-buy" })).toThrow(/method/);
    expect(() => functionCallAction({ ...BUY, args: [] as unknown as Record<string, unknown> })).toThrow(/args/);
  });
});

describe("outcome parsing", () => {
  it("takes the hash from the transaction, or from the transaction outcome id", () => {
    expect(outcomeHash({ transaction: { hash: "a" } })).toBe("a");
    expect(outcomeHash({ transaction_outcome: { id: "b" } })).toBe("b");
    expect(outcomeHash({})).toBeNull();
  });
  it("reads the panic text of a failed outcome", () => {
    expect(outcomeFailure(PANIC)).toEqual({ code: "contract", message: "one key per account: receiver already holds a KEYHOLE key" });
    expect(outcomeFailure(OK)).toBeNull();
  });
});

describe("typed errors", () => {
  it("keeps a contract panic text", () => {
    expect(panicText("Smart contract panicked: attached deposit is below the listing price")).toBe("attached deposit is below the listing price");
    expect(classifyTxText("Smart contract panicked: only the seller can change a listing.")).toEqual({ code: "contract", message: "only the seller can change a listing" });
  });
  it("maps a closed wallet to rejected, and a short balance to insufficient_balance", () => {
    expect(classifyTxError(new Error("User rejected the request")).code).toBe("rejected");
    expect(classifyTxError(new Error("The user closed the window")).code).toBe("rejected");
    expect(classifyTxError(new Error("LackBalanceForState")).code).toBe("insufficient_balance");
    expect(classifyTxError("not enough balance").code).toBe("insufficient_balance");
  });
  it("says nothing is confirmed for anything else, including a gas failure", () => {
    const e = classifyTxError(new Error("Exceeded the prepaid gas"));
    expect(e.code).toBe("unknown");
    expect(e.message).toMatch(/Nothing is confirmed/);
  });
});

describe("sendKeysCall routes", () => {
  it("signed out: nothing is sent", async () => {
    const r = await sendKeysCall({ kind: "none" }, LIST);
    expect(r).toEqual({ error: { code: "signed_out", message: expect.any(String) } });
  });

  it("MetaMask (ethereum-wallets) is refused, and its wallet is never called", async () => {
    const { wallet, calls } = fakeWallet(OK);
    const route: TxRoute = { kind: "ws", accountId: "0xabc", walletId: "ethereum-wallets", wallet, callbackUrl: "https://x/key" };
    const r = await sendKeysCall(route, BUY);
    expect("error" in r && r.error.code).toBe("unsupported_wallet");
    expect(calls).toHaveLength(0);
  });

  it("NEAR Connect: signs with the account and the call's gas and deposit, and returns the hash", async () => {
    const { wallet, calls } = fakeWallet(OK);
    const r = await sendKeysCall({ kind: "nc", accountId: "alice.near", wallet }, BUY);
    expect(r).toEqual({ txHash: "HASH123" });
    expect(calls[0].params).toMatchObject({ signerId: "alice.near", receiverId: "keyhole-devmo.near" });
    expect((calls[0].params.actions as unknown[])[0]).toEqual(functionCallAction(BUY));
  });

  it("wallet selector: passes the callback URL, and a navigating wallet (no result) is a redirect", async () => {
    const { wallet, calls } = fakeWallet(undefined);
    const r = await sendKeysCall({ kind: "ws", accountId: "alice.near", walletId: "my-near-wallet", wallet, callbackUrl: "https://x/key?id=k1" }, LIST);
    expect(r).toEqual({ redirect: true });
    expect(calls[0].params.callbackUrl).toBe("https://x/key?id=k1");
    // wallet-selector v10 only accepts near-api-js actions (it refuses {type, params} with "Unsupported NAJ action").
    const fc = (calls[0].params.actions as { functionCall?: { methodName: string; args: Uint8Array; gas: bigint; deposit: bigint } }[])[0].functionCall;
    expect(fc).toBeDefined();
    expect(fc!.methodName).toBe(LIST.method);
    expect(fc!.gas).toBe(BigInt(GAS_LIST));
    expect(fc!.deposit).toBe(BigInt(LIST.deposit));
    expect(JSON.parse(new TextDecoder().decode(fc!.args))).toEqual(LIST.args);
  });

  it("an executed outcome that failed is a contract error with the panic text", async () => {
    const { wallet } = fakeWallet(PANIC);
    const r = await sendKeysCall({ kind: "nc", accountId: "bob.near", wallet }, BUY);
    expect(r).toEqual({ error: { code: "contract", message: "one key per account: receiver already holds a KEYHOLE key" } });
  });

  it("a wallet that throws a rejection is a rejected error, not a crash", async () => {
    const wallet: TxWallet = { async signAndSendTransaction() { throw new Error("Request rejected by user"); } };
    const r = await sendKeysCall({ kind: "nc", accountId: "bob.near", wallet }, LIST);
    expect("error" in r && r.error.code).toBe("rejected");
  });

  it("a bad call is refused before any wallet is asked", async () => {
    const { wallet, calls } = fakeWallet(OK);
    const r = await sendKeysCall({ kind: "nc", accountId: "bob.near", wallet }, { ...BUY, deposit: "-1" });
    expect("error" in r && r.error.code).toBe("bad_call");
    expect(calls).toHaveLength(0);
  });
});
