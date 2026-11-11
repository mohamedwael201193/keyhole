"use client";
import { Account, JsonRpcProvider, KeyPairEd25519, actions as najActions, type KeyPairString } from "near-api-js";
import { TESTNET_RPCS, TRIAL_CONTRACT, isTestnetRpc } from "./trialPublic";

const STORE = "keyhole.trial.v1";

export type Guest = { accountId: string; secretKey: string };
export type SavedTrial = {
  holder?: Guest;
  receiver?: Guest;
  tokenId?: string;
  mintTx?: string;
  transferTx?: string;
  refusalTx?: string;
  refusal?: string;
};
export type ChainTx = { hash: string | null; ok: boolean; error: string | null; final: unknown | null };
export type TrialToken = { token_id: string; owner_id: string; metadata?: { title?: string | null } | null };

export function freshKey(): { publicKey: string; secretKey: string } {
  const key = KeyPairEd25519.fromRandom();
  return { publicKey: key.publicKey.toString(), secretKey: key.toString() };
}

export function loadTrial(): SavedTrial {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return {};
    const j = JSON.parse(raw) as SavedTrial;
    return j && typeof j === "object" ? j : {};
  } catch { return {}; }
}

export function saveTrial(next: SavedTrial) {
  localStorage.setItem(STORE, JSON.stringify(next));
}

export function clearTrial() {
  localStorage.removeItem(STORE);
}

export async function trialView<T>(method: string, args: Record<string, unknown>, contract = TRIAL_CONTRACT): Promise<T> {
  let last: unknown;
  for (const url of TESTNET_RPCS) {
    if (!isTestnetRpc(url)) continue;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: "trial", method: "query",
          params: {
            request_type: "call_function", finality: "final", account_id: contract, method_name: method,
            args_base64: btoa(JSON.stringify(args)),
          },
        }),
      });
      const j = await r.json() as { error?: unknown; result?: { error?: unknown; result?: number[] } };
      if (!r.ok || j.error || j.result?.error || !j.result?.result) throw new Error("rpc");
      return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result))) as T;
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error("rpc");
}

export async function finalTx(hash: string, signer: string): Promise<unknown | null> {
  let last: unknown = null;
  for (const url of TESTNET_RPCS) {
    if (!isTestnetRpc(url)) continue;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: "trial-tx", method: "tx",
          params: { tx_hash: hash, sender_account_id: signer, wait_until: "FINAL" },
        }),
      });
      const j = await r.json() as { error?: unknown; result?: unknown };
      if (!r.ok || j.error || !j.result) throw new Error("rpc");
      return j.result;
    } catch (e) { last = e; }
  }
  void last;
  return null;
}

function readTx(out: unknown): ChainTx {
  const o = out as { transaction?: { hash?: string }; status?: { Failure?: unknown } } | null;
  const hash = typeof o?.transaction?.hash === "string" ? o.transaction.hash : null;
  const failure = o?.status && typeof o.status === "object" && "Failure" in o.status ? o.status.Failure : null;
  if (failure) {
    const text = JSON.stringify(failure);
    const quoted = text.match(/ExecutionError":"((?:\\.|[^"\\])*)"/);
    const plain = quoted?.[1]?.replace(/\\"/g, "\"") ?? text;
    const panic = plain.match(/panicked: ([^"\\]+)/);
    return { hash, ok: false, error: (panic?.[1] ?? plain).replace(/[.\s]+$/, "").slice(0, 280), final: null };
  }
  if (!hash) return { hash: null, ok: false, error: "The testnet transaction did not return a hash.", final: null };
  return { hash, ok: true, error: null, final: null };
}

/** The guest signs nft_transfer with the key that never left the browser. */
export async function guestTransfer(guest: Guest, tokenId: string, receiverId: string): Promise<ChainTx> {
  let last = "The testnet RPC did not accept the transfer.";
  for (const url of TESTNET_RPCS) {
    if (!isTestnetRpc(url)) continue;
    try {
      if (!guest.secretKey.startsWith("ed25519:")) throw new Error("The guest key is not an ed25519 key.");
      const account = new Account(guest.accountId, new JsonRpcProvider({ url }), guest.secretKey as KeyPairString);
      const out = await account.signAndSendTransaction({
        receiverId: TRIAL_CONTRACT,
        throwOnFailure: false,
        waitUntil: "FINAL",
        actions: [najActions.functionCall("nft_transfer", { receiver_id: receiverId, token_id: tokenId, memo: "practice handover" }, 30_000_000_000_000n, 1n)],
      });
      const sent = readTx(out);
      if (!sent.hash) return sent;
      const final = await finalTx(sent.hash, guest.accountId);
      return { ...sent, final };
    } catch (e) { last = e instanceof Error ? e.message : last; }
  }
  return { hash: null, ok: false, error: last.slice(0, 280), final: null };
}
