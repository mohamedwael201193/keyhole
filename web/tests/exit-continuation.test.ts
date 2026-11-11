import { describe, expect, it } from "vitest";
import type { SignedAuth } from "@/lib/nep413";
import { PLEDGE_EXIT_USDC } from "@/lib/pledgeExit";
import {
  beginExitStep, bindingMatches, browserExitSteps, claimPreview, claimWithdraw, memoryStepStore, planExitReturn,
  readWalletReturn, releaseWithdraw, saveAwaitingWithdraw, saveConfirmed, saveDone, NO_NEW_WITHDRAWAL,
  type ExitBinding, type ExitSnapshot, type ExitStep, type StepStore,
} from "@/lib/exitContinuation";

const binding: ExitBinding = {
  account: "alice.near", token: "k1", epoch: "1", intentId: "intent-1", amount: "100000", asset: PLEDGE_EXIT_USDC, chain: "near",
};
const exit: ExitSnapshot = {
  id: "intent-1", account: "alice.near", token: "k1", epoch: "1", amount: "100000", status: "AwaitingSignature", intent: "withdraw",
};

function auth(op: "withdraw_dry_run" | "withdraw", nonce: string, params: Record<string, unknown> = {}): SignedAuth {
  return {
    account_id: "alice.near", public_key: "ed25519:x", signature: `sig-${nonce}`, nonce, recipient: "keyhole",
    message: JSON.stringify({
      op, account_id: "alice.near", ts_ms: 1,
      params: { intent_id: binding.intentId, token_id: binding.token, owner_epoch: binding.epoch, token: binding.asset, amount: binding.amount, to: binding.account, chain: "near", ...params },
    }),
  };
}

/** The same order LivePledge uses: claim the preview, confirm, then claim the withdrawal. */
function runPopup(store: StepStore, opts: { confirm: boolean; secondPreview?: boolean }) {
  const step = beginExitStep(binding);
  store.save(step);
  const previewAuth = auth("withdraw_dry_run", "preview-nonce");
  let dry = 0;
  let withdraws = 0;
  const first = claimPreview(store, step, previewAuth.nonce);
  if (first === "claimed") dry += 1;
  if (opts.secondPreview) {
    const again = claimPreview(store, step, previewAuth.nonce);
    if (again === "claimed") dry += 1;
  }
  const saved = store.loadIntent(binding.account, binding.intentId)!;
  const confirmed = saveConfirmed(store, saved, { amount_out: "990000", min_amount_out: "985000" });
  if (!opts.confirm) {
    store.drop(confirmed);
    return { dry, withdraws, phase: store.loadIntent(binding.account, binding.intentId)?.phase ?? "dropped" };
  }
  const signing = saveAwaitingWithdraw(store, confirmed);
  const withdrawAuth = auth("withdraw", "withdraw-nonce");
  if (claimWithdraw(store, signing, withdrawAuth)) withdraws += 1;
  if (claimWithdraw(store, signing, withdrawAuth)) withdraws += 1;
  saveDone(store, signing, withdrawAuth.nonce);
  return { dry, withdraws, phase: store.loadIntent(binding.account, binding.intentId)?.phase };
}

describe("exit continuation", () => {
  it("popup wallet signs one withdrawal after the preview and the confirm", () => {
    const ran = runPopup(memoryStepStore(), { confirm: true, secondPreview: true });
    expect(ran).toEqual({ dry: 1, withdraws: 1, phase: "done" });
  });

  it("popup wallet rejection at the confirm signs nothing", () => {
    const ran = runPopup(memoryStepStore(), { confirm: false });
    expect(ran.dry).toBe(1);
    expect(ran.withdraws).toBe(0);
    expect(ran.phase).toBe("dropped");
  });

  it("redirect return of the dry-run signature continues once, and the same nonce does not start another withdrawal", () => {
    const store = memoryStepStore();
    store.save(beginExitStep(binding));
    const previewAuth = auth("withdraw_dry_run", "preview-nonce");
    const back = planExitReturn({
      activeAccount: "alice.near", activeToken: "k1", callback: readWalletReturn(""),
      pending: previewAuth, step: store.loadIntent(binding.account, binding.intentId), exit,
    });
    expect(back.type).toBe("run_preview");
    if (back.type !== "run_preview") return;
    expect(claimPreview(store, back.step, previewAuth.nonce)).toBe("claimed");
    const repeat = planExitReturn({
      activeAccount: "alice.near", activeToken: "k1", callback: { kind: "none" },
      pending: previewAuth, step: store.loadIntent(binding.account, binding.intentId), exit,
    });
    expect(repeat.type).toBe("ignore");
    const confirmed = saveConfirmed(store, store.loadIntent(binding.account, binding.intentId)!, { amount_out: "990000", min_amount_out: "985000" });
    const signing = saveAwaitingWithdraw(store, confirmed);
    const withdrawAuth = auth("withdraw", "withdraw-nonce");
    expect(planExitReturn({
      activeAccount: "alice.near", activeToken: "k1", callback: { kind: "none" },
      pending: withdrawAuth, step: signing, exit,
    }).type).toBe("ignore");
    expect(claimWithdraw(store, signing, withdrawAuth)).toBe(true);
    expect(claimWithdraw(store, signing, withdrawAuth)).toBe(false);
    expect(saveDone(store, signing, withdrawAuth.nonce).phase).toBe("done");
    const latePreview = planExitReturn({
      activeAccount: "alice.near", activeToken: "k1", callback: { kind: "none" },
      pending: previewAuth, step: store.loadNonce(binding.account, previewAuth.nonce), exit,
    });
    expect(latePreview.type).toBe("ambiguous");
    if (latePreview.type === "ambiguous") expect(latePreview.reason).toContain(NO_NEW_WITHDRAWAL);
  });

  it("reloads an accepted preview into confirm without another dry run", () => {
    const store = memoryStepStore();
    const confirmed = saveConfirmed(store, { ...beginExitStep(binding), phase: "preview_inflight", previewNonce: "preview-nonce" }, { amount_out: "990000", min_amount_out: "985000" });
    const plan = planExitReturn({
      activeAccount: "alice.near", activeToken: "k1", callback: { kind: "none" }, pending: null, step: confirmed, exit,
    });
    expect(plan.type).toBe("confirm");
    expect(claimPreview(store, confirmed, "preview-nonce")).toBe("confirm");
  });

  it("user rejection (errorCode) cancels the in-flight step and signs nothing", () => {
    const store = memoryStepStore();
    const step = beginExitStep(binding);
    store.save(step);
    const plan = planExitReturn({
      activeAccount: "alice.near", activeToken: "k1",
      callback: readWalletReturn("?errorCode=userRejected&errorMessage=User+rejected+the+signature"),
      pending: null, step, exit,
    });
    expect(plan.type).toBe("cancel");
    if (plan.type === "cancel") {
      expect(plan.reason).toContain("userRejected");
      expect(plan.reason).toContain(NO_NEW_WITHDRAWAL);
      store.drop(plan.step);
    }
    expect(store.loadIntent(binding.account, binding.intentId)).toBeNull();
    expect(claimWithdraw(store, step, auth("withdraw", "withdraw-nonce"))).toBe(false);
  });

  it("a transactionHashes callback is not a withdrawal signature", () => {
    const step = beginExitStep(binding);
    const plan = planExitReturn({
      activeAccount: "alice.near", activeToken: "k1",
      callback: readWalletReturn("?transactionHashes=5rZ...abc"),
      pending: null, step, exit,
    });
    expect(plan.type).toBe("ambiguous");
    if (plan.type === "ambiguous") {
      expect(plan.clearPending).toBe(false);
      expect(plan.reason).toContain(NO_NEW_WITHDRAWAL);
    }
  });

  it("an unbound or other-account preview is not applied", () => {
    const unbound = planExitReturn({
      activeAccount: "alice.near", activeToken: "k1", callback: { kind: "none" },
      pending: { account_id: "alice.near", nonce: "n", message: JSON.stringify({ op: "withdraw_dry_run", account_id: "alice.near", params: {} }) },
      step: null, exit,
    });
    expect(unbound.type).toBe("ambiguous");
    if (unbound.type === "ambiguous") expect(unbound.clearPending).toBe(true);
    const other = planExitReturn({
      activeAccount: "bob.near", activeToken: "k1", callback: { kind: "none" },
      pending: auth("withdraw_dry_run", "preview-nonce"), step: beginExitStep(binding), exit,
    });
    expect(other.type).toBe("ambiguous");
    if (other.type === "ambiguous") expect(other.clearPending).toBe(false);
  });

  it("a rejected withdraw signature can be released without opening a second preview", () => {
    const store = memoryStepStore();
    const signing = saveAwaitingWithdraw(store, saveConfirmed(store, { ...beginExitStep(binding), previewNonce: "preview-nonce", phase: "preview_inflight" }, { amount_out: "1", min_amount_out: "1" }));
    const withdrawAuth = auth("withdraw", "withdraw-nonce");
    expect(claimWithdraw(store, signing, withdrawAuth)).toBe(true);
    releaseWithdraw(store, signing);
    expect(store.loadIntent(binding.account, binding.intentId)?.phase).toBe("awaiting_withdraw");
    expect(store.loadIntent(binding.account, binding.intentId)?.withdrawNonce).toBeUndefined();
    expect(claimPreview(store, beginExitStep(binding), "preview-nonce")).toBe("stop");
    expect(claimWithdraw(store, signing, withdrawAuth)).toBe(true);
  });

  it("stores the step under account + nonce in sessionStorage", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, v); },
      removeItem: (k: string) => { mem.delete(k); },
    };
    const store = browserExitSteps(storage);
    const step: ExitStep = { ...beginExitStep(binding), previewNonce: "preview-nonce", phase: "awaiting_confirm", preview: { amount_out: "9", min_amount_out: "8" } };
    store.save(step);
    expect(mem.has(`keyhole:pledge-exit-step:v1:${binding.account}:preview-nonce`)).toBe(true);
    expect(store.loadNonce(binding.account, "preview-nonce")?.binding).toEqual(binding);
    expect(bindingMatches(binding, auth("withdraw_dry_run", "preview-nonce"), "withdraw_dry_run")).toBe(true);
    expect(bindingMatches(binding, auth("withdraw_dry_run", "preview-nonce", { owner_epoch: "9" }), "withdraw_dry_run")).toBe(false);
  });
});
