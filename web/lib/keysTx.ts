"use client";
/**
 * Sends one FunctionCall to the keys contract from the signed-in account, through the wallet that account signed in with.
 * Every route reuses the wallet object that already exists in lib/wallet.tsx: the wallet-selector wallet, the NEAR Connect
 * wallet, or the Privy signer (near-api-js Account). MetaMask (the ethereum-wallets module) is refused here on purpose:
 * that module sends through a relayer with its own onboarding transactions and per-transaction EVM confirmations, which this
 * build does not verify, so a sale or purchase from MetaMask is not offered.
 *
 * Results are typed: { txHash } when the wallet returns an executed outcome, { redirect: true } when a browser wallet takes
 * the user to its own page (the hash comes back in the URL), or { error } with a code and a plain message. A contract panic
 * keeps its text (for example "one key per account: ..."). Nothing is claimed as sent until the wallet reports a hash.
 */
import { Account, JsonRpcProvider, actions as najActions, type Signer } from "near-api-js";
import { KEYS_CONTRACT, RPC_URL } from "./config";

/**
 * Prepaid gas per sale call, measured on a mainnet-state fork (not guessed):
 * - nft_list and nft_unlist: 30 TGas. Each writes one listing and one index entry.
 * - nft_buy: 50 TGas. It moves the key, pays the royalty and the seller, and burns about 13 TGas. At 10 TGas it fails with
 *   "Exceeded the prepaid gas", so nothing may use a smaller value here.
 * Pinned by tests/keysTx.test.ts.
 */
export const GAS_LIST_TGAS = 30;
export const GAS_BUY_TGAS = 50;
export const GAS_LIST = String(GAS_LIST_TGAS * 10 ** 12);
export const GAS_BUY = String(GAS_BUY_TGAS * 10 ** 12);
/** The one yoctoNEAR a sensitive call requires (price change, unlist, transfers). */
export const ONE_YOCTO = "1";

export type KeysCall = {
  method: string;
  args: Record<string, unknown>;
  /** yoctoNEAR as a decimal string. "0" for no deposit. */
  deposit: string;
  /** Gas as a decimal string. Required: use GAS_LIST or GAS_BUY. */
  gas: string;
};

/** The selector's FunctionCall action, as wallet-selector and near-connect both accept it. */
export type FunctionCallAction = { type: "FunctionCall"; params: { methodName: string; args: object; gas: string; deposit: string } };

/** The subset of a wallet's transaction method this module calls. Structural, so no wallet type is imported. */
export type TxWallet = {
  signAndSendTransaction(params: { signerId?: string; receiverId: string; actions: unknown[]; callbackUrl?: string }): Promise<unknown>;
};

export type TxRoute =
  | { kind: "nc"; accountId: string; wallet: TxWallet }
  | { kind: "ws"; accountId: string; walletId: string; wallet: TxWallet; callbackUrl: string }
  | { kind: "privy"; accountId: string; signer: Signer }
  | { kind: "none" };

export type TxErrorCode = "signed_out" | "unsupported_wallet" | "rejected" | "insufficient_balance" | "contract" | "bad_call" | "unknown";
export type TxError = { code: TxErrorCode; message: string };
export type SendResult = { txHash: string } | { redirect: true } | { error: TxError };

const YOCTO = /^\d+$/;
const GAS = /^\d+$/;

/** The selector-format action for one call. Throws on a call that could not be sent (bad method, deposit or gas). */
export function functionCallAction(call: KeysCall): FunctionCallAction {
  if (!call.method || !/^[a-z_]+$/.test(call.method)) throw new Error(`bad method: ${call.method}`);
  if (typeof call.deposit !== "string" || !YOCTO.test(call.deposit)) throw new Error("deposit must be a yoctoNEAR decimal string");
  const gas = call.gas;
  if (typeof gas !== "string" || !GAS.test(gas)) throw new Error("gas must be a decimal string");
  if (!call.args || typeof call.args !== "object" || Array.isArray(call.args)) throw new Error("args must be an object");
  return { type: "FunctionCall", params: { methodName: call.method, args: call.args, gas, deposit: call.deposit } };
}

/** Plain text of anything a wallet or RPC throws, including the nested failure of a transaction outcome. */
function textOf(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e) ?? String(e); } catch { return String(e); }
}

/** The panic text of a contract call ("one key per account: ..."), when there is one. */
export function panicText(s: string): string | null {
  const m = s.match(/panicked: ([^"\\\n]+)/);
  if (!m) return null;
  return m[1].trim().replace(/[.\s]+$/, "");
}

/** Maps a failure text (a thrown error or a failed outcome) to the typed error the UI shows. */
export function classifyTxText(s: string): TxError {
  const panic = panicText(s);
  if (panic) return { code: "contract", message: panic };
  if (/LackBalance|NotEnoughBalance|insufficient|not enough balance|balance too low/i.test(s)) {
    return { code: "insufficient_balance", message: "The wallet does not have enough NEAR for this price and the fees." };
  }
  if (/reject|denied|declin|cancel|closed the|user closed|aborted/i.test(s)) {
    return { code: "rejected", message: "The wallet request was closed or rejected. Nothing was sent." };
  }
  return { code: "unknown", message: "The transaction did not complete. Nothing is confirmed on NEAR." };
}

export function classifyTxError(e: unknown): TxError {
  return classifyTxText(textOf(e));
}

/** The hash of an executed outcome, or null. */
export function outcomeHash(o: unknown): string | null {
  const x = o as { transaction?: { hash?: unknown }; transaction_outcome?: { id?: unknown } } | null;
  const h = x?.transaction?.hash ?? x?.transaction_outcome?.id;
  return typeof h === "string" && h.length > 0 ? h : null;
}

/** The failure of an executed outcome (status.Failure), or null when it succeeded. */
export function outcomeFailure(o: unknown): TxError | null {
  const st = (o as { status?: unknown } | null)?.status;
  if (!st || typeof st !== "object" || !("Failure" in st)) return null;
  const f = (st as { Failure: unknown }).Failure;
  const exec = (f as { ActionError?: { kind?: { FunctionCallError?: { ExecutionError?: unknown } } } } | null)?.ActionError?.kind?.FunctionCallError?.ExecutionError;
  return classifyTxText(typeof exec === "string" ? exec : textOf(f));
}

/** The wallet route for the signed-in account. Built in lib/wallet.tsx from the wallet that is connected. */
export async function sendKeysCall(route: TxRoute, call: KeysCall, contractId = KEYS_CONTRACT): Promise<SendResult> {
  if (route.kind === "none") return { error: { code: "signed_out", message: "Sign in with a NEAR wallet to send this." } };
  if (route.kind === "ws" && route.walletId === "ethereum-wallets") {
    return { error: { code: "unsupported_wallet", message: "Selling and buying keys is not supported for MetaMask in this build. Sign in with a NEAR wallet." } };
  }
  let action: FunctionCallAction;
  try { action = functionCallAction(call); } catch (e) {
    return { error: { code: "bad_call", message: textOf(e) } };
  }
  let outcome: unknown;
  try {
    if (route.kind === "nc") {
      outcome = await route.wallet.signAndSendTransaction({ signerId: route.accountId, receiverId: contractId, actions: [action] });
    } else if (route.kind === "ws") {
      outcome = await route.wallet.signAndSendTransaction({ signerId: route.accountId, receiverId: contractId, actions: [action], callbackUrl: route.callbackUrl });
    } else {
      const account = new Account(route.accountId, new JsonRpcProvider({ url: RPC_URL }), route.signer);
      outcome = await account.signAndSendTransaction({
        receiverId: contractId,
        actions: [najActions.functionCall(call.method, call.args, BigInt(action.params.gas), BigInt(call.deposit))],
        throwOnFailure: true,
      });
    }
  } catch (e) {
    return { error: classifyTxError(e) };
  }
  // A browser wallet (MyNearWallet and similar) navigates away and resolves with nothing. Its result returns in the URL.
  if (outcome === undefined || outcome === null) return { redirect: true };
  const failed = outcomeFailure(outcome);
  if (failed) return { error: failed };
  const hash = outcomeHash(outcome);
  if (!hash) return { error: { code: "unknown", message: "The wallet did not return a transaction hash. Check the account on NEAR before trying again." } };
  return { txHash: hash };
}
