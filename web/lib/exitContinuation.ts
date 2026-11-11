/**
 * Preview → confirm → withdraw continuation for an ordinary exit.
 * Redirect wallets (MyNearWallet, Meteor web) leave the page on each signature and come back with
 * either a NEP-413 hash (wallet `pending`) or `errorCode` / `transactionHashes` on the callback URL.
 * The step is stored under account + nonce. The signature itself is not stored.
 * A mismatched account, token, epoch or intent, a rejection, or a transaction hash does not start a withdrawal.
 */
import type { SignedAuth } from "./nep413";

export const EXIT_STEP_PREFIX = "keyhole:pledge-exit-step:v1";

export type ExitBinding = {
  account: string;
  token: string;
  epoch: string;
  intentId: string;
  amount: string;
  asset: string;
  chain: "near";
};

export type ExitPreview = { amount_out: string; min_amount_out: string };

export type ExitStep = {
  phase: "awaiting_preview" | "preview_inflight" | "awaiting_confirm" | "awaiting_withdraw" | "done";
  binding: ExitBinding;
  /** Empty until the dry-run signature's nonce is known. Storage key is account + this nonce. */
  previewNonce: string;
  preview?: ExitPreview;
  withdrawNonce?: string;
};

export type ExitSnapshot = {
  id?: string;
  account: string;
  token: string;
  epoch: string;
  amount: string;
  status: string;
  intent?: string;
  value_op_id?: string;
};

export type WalletReturn =
  | { kind: "none" }
  | { kind: "rejected"; errorCode: string }
  | { kind: "transaction"; hashes: string[] };

export const NO_NEW_WITHDRAWAL = "No new withdrawal was signed.";

/** Callback query used by wallet-selector redirect transports. A hash signature is handled separately as `pending`. */
export function readWalletReturn(search: string): WalletReturn {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const errorCode = q.get("errorCode");
  if (errorCode) return { kind: "rejected", errorCode };
  const raw = q.get("transactionHashes");
  if (raw) {
    const hashes = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (hashes.length) return { kind: "transaction", hashes };
  }
  return { kind: "none" };
}

export function nonceKey(account: string, nonce: string): string {
  return `${EXIT_STEP_PREFIX}:${account}:${nonce}`;
}
export function intentKey(account: string, intentId: string): string {
  return `${EXIT_STEP_PREFIX}:${account}:intent:${intentId}`;
}

export function beginExitStep(binding: ExitBinding): ExitStep {
  return { phase: "awaiting_preview", binding, previewNonce: "" };
}

export type StepStore = {
  save(step: ExitStep): void;
  loadNonce(account: string, nonce: string): ExitStep | null;
  loadIntent(account: string, intentId: string): ExitStep | null;
  drop(step: ExitStep): void;
};

function parseStep(raw: string | null): ExitStep | null {
  if (!raw || raw.length > 8192) return null;
  try {
    const s = JSON.parse(raw) as ExitStep;
    if (!s?.binding || typeof s.binding.account !== "string" || typeof s.binding.intentId !== "string" || typeof s.phase !== "string") return null;
    return s;
  } catch { return null; }
}

export function memoryStepStore(mem: Map<string, string> = new Map()): StepStore {
  return {
    save(step) {
      const json = JSON.stringify(step);
      mem.set(intentKey(step.binding.account, step.binding.intentId), json);
      if (step.previewNonce) mem.set(nonceKey(step.binding.account, step.previewNonce), json);
      if (step.withdrawNonce) mem.set(nonceKey(step.binding.account, step.withdrawNonce), json);
    },
    loadNonce: (account, nonce) => parseStep(mem.get(nonceKey(account, nonce)) ?? null),
    loadIntent: (account, intentId) => parseStep(mem.get(intentKey(account, intentId)) ?? null),
    drop(step) {
      mem.delete(intentKey(step.binding.account, step.binding.intentId));
      if (step.previewNonce) mem.delete(nonceKey(step.binding.account, step.previewNonce));
      if (step.withdrawNonce) mem.delete(nonceKey(step.binding.account, step.withdrawNonce));
    },
  };
}

export function browserExitSteps(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">): StepStore {
  return {
    save(step) {
      const json = JSON.stringify(step);
      storage.setItem(intentKey(step.binding.account, step.binding.intentId), json);
      if (step.previewNonce) storage.setItem(nonceKey(step.binding.account, step.previewNonce), json);
      if (step.withdrawNonce) storage.setItem(nonceKey(step.binding.account, step.withdrawNonce), json);
    },
    loadNonce: (account, nonce) => parseStep(storage.getItem(nonceKey(account, nonce))),
    loadIntent: (account, intentId) => parseStep(storage.getItem(intentKey(account, intentId))),
    drop(step) {
      storage.removeItem(intentKey(step.binding.account, step.binding.intentId));
      if (step.previewNonce) storage.removeItem(nonceKey(step.binding.account, step.previewNonce));
      if (step.withdrawNonce) storage.removeItem(nonceKey(step.binding.account, step.withdrawNonce));
    },
  };
}

type Parsed = { op?: string; account_id?: string; params?: Record<string, unknown> };

export function previewFields(message: string): (Parsed & Record<string, unknown>) | null {
  try {
    const m = JSON.parse(message) as Parsed;
    if (!m || typeof m !== "object" || !m.params || typeof m.params !== "object") return null;
    return { ...m.params, op: m.op, account_id: m.account_id };
  } catch { return null; }
}

export function bindingMatches(binding: ExitBinding, auth: Pick<SignedAuth, "account_id" | "message">, op: "withdraw_dry_run" | "exact_near_exit_v1"): boolean {
  const p = previewFields(auth.message);
  if (!p) return false;
  return auth.account_id === binding.account
    && p.account_id === binding.account
    && p.op === op
    && p.intent_id === binding.intentId
    && p.token_id === binding.token
    && p.owner_epoch === binding.epoch
    && p.amount === binding.amount
    && p.to === binding.account
    && p.chain === binding.chain
    && p.token === binding.asset;
}

function openExit(exit: ExitSnapshot | null, binding: ExitBinding): boolean {
  return !!exit?.id
    && exit.id === binding.intentId
    && exit.account === binding.account
    && exit.token === binding.token
    && exit.epoch === binding.epoch
    && exit.amount === binding.amount
    && exit.intent === "exact_near_exit_v1"
    && !exit.value_op_id
    && (exit.status === "AwaitingSignature" || exit.status === "Retryable");
}

export type ResumePlan =
  | { type: "ignore" }
  | { type: "ambiguous"; reason: string; clearPending: boolean }
  | { type: "cancel"; reason: string; step: ExitStep }
  | { type: "run_preview"; step: ExitStep }
  | { type: "confirm"; step: ExitStep };

/**
 * What a redirect return is allowed to do. `run_preview` is the only plan that calls the worker for a dry run.
 * `confirm` repeats the confirm step after a reload and does not call the worker again.
 */
export function planExitReturn(input: {
  activeAccount: string | null;
  activeToken: string;
  callback: WalletReturn;
  pending: Pick<SignedAuth, "account_id" | "message" | "nonce"> | null;
  step: ExitStep | null;
  exit: ExitSnapshot | null;
}): ResumePlan {
  const { activeAccount, activeToken, callback, pending, step, exit } = input;
  if (callback.kind === "rejected") {
    if (step && step.phase !== "done" && step.binding.account === (activeAccount ?? step.binding.account) && step.binding.token === activeToken) {
      return { type: "cancel", reason: `The wallet returned ${callback.errorCode}. ${NO_NEW_WITHDRAWAL}`, step };
    }
    return { type: "ignore" };
  }
  if (pending) {
    const fields = previewFields(pending.message);
    const op = fields?.op;
    if (op === "exact_near_exit_v1") return { type: "ignore" };
    if (op !== "withdraw_dry_run") return { type: "ignore" };
    if (!activeAccount || pending.account_id !== activeAccount) {
      return { type: "ambiguous", reason: `The returned route preview is for another account. ${NO_NEW_WITHDRAWAL}`, clearPending: false };
    }
    const asset = typeof fields?.token === "string" ? fields.token : "";
    const fromExit: ExitBinding | null = exit?.id ? {
      account: exit.account, token: exit.token, epoch: exit.epoch, intentId: exit.id, amount: exit.amount, asset, chain: "near",
    } : null;
    const binding = step && bindingMatches(step.binding, pending, "withdraw_dry_run") ? step.binding
      : fromExit && bindingMatches(fromExit, pending, "withdraw_dry_run") ? fromExit
      : null;
    if (!binding || binding.token !== activeToken || !openExit(exit, binding)) {
      return { type: "ambiguous", reason: `This returned route preview does not match the saved exit. ${NO_NEW_WITHDRAWAL}`, clearPending: true };
    }
    const current: ExitStep = step && step.binding.intentId === binding.intentId ? step : { phase: "awaiting_preview", binding, previewNonce: "" };
    if (current.previewNonce && current.previewNonce !== pending.nonce) {
      return { type: "ambiguous", reason: `This route preview nonce does not match the saved step. ${NO_NEW_WITHDRAWAL}`, clearPending: true };
    }
    if ((current.phase === "awaiting_withdraw" || current.phase === "done") && current.previewNonce === pending.nonce) {
      return { type: "ambiguous", reason: `This route preview was already continued. ${NO_NEW_WITHDRAWAL}`, clearPending: true };
    }
    if (current.phase === "preview_inflight" && current.previewNonce === pending.nonce) return { type: "ignore" };
    if (current.phase === "awaiting_confirm" && current.preview && current.previewNonce === pending.nonce) return { type: "confirm", step: current };
    return { type: "run_preview", step: { ...current, binding, previewNonce: pending.nonce } };
  }
  if (callback.kind === "transaction" && step && (step.phase === "awaiting_preview" || step.phase === "preview_inflight" || step.phase === "awaiting_withdraw") && step.binding.account === activeAccount && step.binding.token === activeToken) {
    return { type: "ambiguous", reason: `A transaction hash is not this exit's signature. ${NO_NEW_WITHDRAWAL}`, clearPending: false };
  }
  if (step?.phase === "awaiting_confirm" && step.preview && step.binding.account === activeAccount && step.binding.token === activeToken && openExit(exit, step.binding)) {
    return { type: "confirm", step };
  }
  return { type: "ignore" };
}

/** Second caller does not run the preview. The update is synchronous, so two calls cannot both claim. */
export function claimPreview(store: StepStore, step: ExitStep, nonce: string): "claimed" | "confirm" | "stop" {
  const current = store.loadIntent(step.binding.account, step.binding.intentId) ?? step;
  if (current.binding.account !== step.binding.account || current.binding.intentId !== step.binding.intentId) return "stop";
  if (current.previewNonce && current.previewNonce !== nonce) return "stop";
  if (current.phase === "awaiting_confirm" && current.preview && current.previewNonce === nonce) return "confirm";
  if (current.phase === "preview_inflight" || current.phase === "awaiting_withdraw" || current.phase === "done") return "stop";
  if (current.phase !== "awaiting_preview") return "stop";
  store.save({ ...current, binding: step.binding, phase: "preview_inflight", previewNonce: nonce });
  return "claimed";
}

export function saveConfirmed(store: StepStore, step: ExitStep, preview: ExitPreview): ExitStep {
  const next: ExitStep = { ...step, phase: "awaiting_confirm", preview };
  store.save(next);
  return next;
}

export function saveAwaitingWithdraw(store: StepStore, step: ExitStep): ExitStep {
  const next: ExitStep = { ...step, phase: "awaiting_withdraw" };
  store.save(next);
  return next;
}

export function saveDone(store: StepStore, step: ExitStep, withdrawNonce: string): ExitStep {
  const next: ExitStep = { ...step, phase: "done", withdrawNonce };
  store.save(next);
  return next;
}

/** One withdraw signature per step. A repeat of the same nonce does not pass. */
export function claimWithdraw(store: StepStore, step: ExitStep, auth: Pick<SignedAuth, "account_id" | "message" | "nonce">): boolean {
  const current = store.loadIntent(step.binding.account, step.binding.intentId);
  if (!current || current.phase !== "awaiting_withdraw" || current.withdrawNonce) return false;
  if (!bindingMatches(current.binding, auth, "exact_near_exit_v1")) return false;
  store.save({ ...current, withdrawNonce: auth.nonce });
  return true;
}

/** Puts a claimed withdraw back so a rejected signature can be replaced. Does not open a second preview. */
export function releaseWithdraw(store: StepStore, step: ExitStep): void {
  const current = store.loadIntent(step.binding.account, step.binding.intentId);
  if (!current || current.phase === "done" || !current.withdrawNonce) return;
  store.drop(current);
  store.save({ phase: "awaiting_withdraw", binding: current.binding, previewNonce: current.previewNonce, preview: current.preview });
}
