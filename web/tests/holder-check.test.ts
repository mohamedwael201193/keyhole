import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { holderResult, holderResume, settleHolderCheck } from "@/lib/holderCheck";

const granted = { granted: true, account_id: "a.near", tier: 2, token_ids: ["k5f4750858f328940"], key_count: 1 };

function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("holder proof identity", () => {
  it("shows a grant only for the account that was checked", () => {
    expect(holderResult({
      requestedAccount: "a.near", requestedSeq: 1, activeAccount: "a.near", activeSeq: 1, aborted: false, body: granted,
    })).toMatchObject({ status: "granted", accountId: "a.near", tier: 2, token_ids: ["k5f4750858f328940"] });
  });

  it("drops account A's proof when the screen has switched to B", async () => {
    const gate = deferred<{ body: typeof granted }>();
    const ctrl = new AbortController();
    let active: { account: string | null; seq: number } = { account: "a.near", seq: 1 };
    const task = settleHolderCheck({
      requestedAccount: "a.near", requestedSeq: 1, signal: ctrl.signal, current: () => active,
      send: () => gate.promise,
    });
    active = { account: "b.near", seq: 2 };
    ctrl.abort();
    gate.resolve({ body: granted });
    expect(await task).toEqual({ status: "idle" });
    expect(holderResult({
      requestedAccount: "a.near", requestedSeq: 1, activeAccount: "b.near", activeSeq: 2, aborted: false, body: granted,
    })).toEqual({ status: "idle" });
  });

  it("drops the in-flight check when the wallet disconnects", async () => {
    const gate = deferred<{ body: typeof granted }>();
    const ctrl = new AbortController();
    let active: { account: string | null; seq: number } = { account: "a.near", seq: 1 };
    const task = settleHolderCheck({
      requestedAccount: "a.near", requestedSeq: 1, signal: ctrl.signal, current: () => active,
      send: (signal) => {
        signal.addEventListener("abort", () => gate.resolve({ body: granted }));
        return gate.promise;
      },
    });
    active = { account: null, seq: 2 };
    ctrl.abort();
    expect(await task).toEqual({ status: "idle" });
  });

  it("does not treat another account's body as this account's grant", () => {
    expect(holderResult({
      requestedAccount: "b.near", requestedSeq: 3, activeAccount: "b.near", activeSeq: 3, aborted: false,
      body: { ...granted, account_id: "a.near" },
    })).toEqual({ status: "idle" });
  });

  it("resumes a redirect signature only for the signed-in account", () => {
    const pending = {
      account_id: "a.near",
      message: JSON.stringify({ op: "holder_gate", account_id: "a.near", params: { challenge: "ch-1" } }),
    };
    expect(holderResume(pending, "a.near")).toEqual({ action: "submit", challenge: "ch-1" });
    expect(holderResume(pending, "b.near")).toEqual({ action: "wait" });
    expect(holderResume(pending, null)).toEqual({ action: "wait" });
    expect(holderResume({ account_id: "a.near", message: JSON.stringify({ op: "withdraw", params: {} }) }, "a.near")).toEqual({ action: "ignore" });
  });

  it("the holders screen clears on account change and drops a stale response", () => {
    const view = readFileSync(new URL("../app/holders/view.tsx", import.meta.url), "utf8");
    expect(view).toContain("settleHolderCheck(");
    expect(view).toContain("new AbortController()");
    expect(view).toContain("}, [acct]);");
    expect(view).toContain("if (seq.current === my) setCheck(next)");
    expect(view).toContain("holderResume(wallet.pending, acct)");
    expect(view).toContain('check.accountId === acct');
  });
});
