import { nearView } from "./rpc";
import { KEYS_CONTRACT, RPC_URL } from "./config";
import { isMethodNotFound } from "./rpcError";

type Read = <T>(method: string, args: Record<string, unknown>) => Promise<T>;
/** Historical v2.4 only. Never derive this exception from the current deployment identity. */
export const LIVE_V24_CODE_HASH = "DEXHHyEMdFTdFQ32dYnj264RSj3QG2FSwCY5fbjzSiZZ";
export const guardedValueOp = (op: string, params: Record<string, unknown>) =>
  ["swap", "copy", "withdraw", "withdraw_dry_run", "transfer"].includes(op) || (op === "quote" && params.execute === true);
export const decimalEpoch = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9]\d*)$/.test(v) && BigInt(v) <= 18446744073709551615n;

export type ContractProfile = "v2.4" | "v2.5";
export type SessionBind = { token_id: string; owner_epoch?: string; profile?: ContractProfile };

/** Final account code hash. Read-only view_account; not a contract call. */
export async function readLiveCodeHash(contract = KEYS_CONTRACT): Promise<string> {
  const r = await fetch(RPC_URL, {
    method: "POST", headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(8_000), cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: "kh-code", method: "query", params: { request_type: "view_account", finality: "final", account_id: contract } }),
  });
  const j = await r.json();
  const hash = j?.result?.code_hash;
  if (!r.ok || j?.error || typeof hash !== "string") throw new Error(j?.error?.cause?.name || j?.error?.message || "code_hash_unavailable");
  return hash;
}

function legacyParams(params: Record<string, unknown>, token: string): Record<string, unknown> {
  const next: Record<string, unknown> = { ...params, token_id: token };
  delete next.owner_epoch;
  return next;
}

/**
 * Final, uncached owner/control reads BEFORE any signature. Never mutate signed JSON.
 * Live v2.4 has no get_control_state. A definitive MethodNotFound on the pinned code hash
 * keeps the v2.4 envelope and does not invent an epoch. Any other read error fails closed.
 * A present control view keeps the guarded v2.5 epoch bind, including A→B→A.
 */
export async function prepareGuardedRequest(op: string, account: string, params: Record<string, unknown>,
  session?: SessionBind,
  read: Read = (method, args) => nearView(method, args, KEYS_CONTRACT, { shared: false }),
  codeHash: () => Promise<string> = () => readLiveCodeHash()) {
  if (!guardedValueOp(op, params)) return params;
  let token = params.token_id;
  if (!token) {
    const held = await read<{ token_id: string }[]>("nft_tokens_for_owner", { account_id: account, from_index: "0", limit: 2 });
    if (held.length !== 1) throw new Error("Select the exact key before signing.");
    token = held[0].token_id;
  }
  if (typeof token !== "string" || !token) throw new Error("Invalid key.");
  const nft = await read<{ owner_id: string } | null>("nft_token", { token_id: token });
  if (nft?.owner_id !== account) throw new Error("not_owner");
  let control: { token_id: string; owner_epoch: string; transfer_pending: boolean };
  try {
    control = await read("get_control_state", { token_id: token });
  } catch (e) {
    if (!isMethodNotFound(e)) throw e;
    if (await codeHash() !== LIVE_V24_CODE_HASH) throw new Error("unpinned_contract");
    if (session && (session.profile === "v2.5" || decimalEpoch(session.owner_epoch) || session.token_id !== token)) throw new Error("session_epoch: title changed; unlock again");
    return legacyParams(params, token);
  }
  if (control.token_id !== token || !decimalEpoch(control.owner_epoch) || control.transfer_pending !== false) throw new Error("guard_state");
  if (session && (session.profile === "v2.4" || !decimalEpoch(session.owner_epoch) || session.token_id !== token || session.owner_epoch !== control.owner_epoch)) throw new Error("session_epoch: title changed; unlock again");
  if (params.owner_epoch !== undefined && params.owner_epoch !== control.owner_epoch) throw new Error("epoch_changed: sign again");
  return { ...params, token_id: token, owner_epoch: control.owner_epoch };
}

/** Feature detection for a session grant that did not return owner_epoch. Does not invent epoch zero. */
export async function contractProfile(tokenId: string,
  read: Read = (method, args) => nearView(method, args, KEYS_CONTRACT, { shared: false }),
  codeHash: () => Promise<string> = () => readLiveCodeHash()): Promise<ContractProfile> {
  try {
    await read("get_control_state", { token_id: tokenId || "0" });
    return "v2.5";
  } catch (e) {
    if (!isMethodNotFound(e)) throw e;
    if (await codeHash() !== LIVE_V24_CODE_HASH) throw new Error("unpinned_contract");
    return "v2.4";
  }
}
