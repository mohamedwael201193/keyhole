import { nearView } from "./rpc";
import { KEYS_CONTRACT } from "./config";

type Read = <T>(method: string, args: Record<string, unknown>) => Promise<T>;
export const guardedValueOp = (op: string, params: Record<string, unknown>) =>
  ["swap", "copy", "withdraw", "transfer"].includes(op) || (op === "quote" && params.execute === true);
export const decimalEpoch = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9]\d*)$/.test(v) && BigInt(v) <= 18446744073709551615n;
/** Final, uncached owner/control reads BEFORE any signature, including redirect wallets. Never mutate signed JSON. */
export async function prepareGuardedRequest(op: string, account: string, params: Record<string, unknown>,
  session?: { token_id: string; owner_epoch: string },
  read: Read = (method, args) => nearView(method, args, KEYS_CONTRACT, { shared: false })) {
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
  const control = await read<{ token_id: string; owner_epoch: string; transfer_pending: boolean }>("get_control_state", { token_id: token });
  if (control.token_id !== token || !decimalEpoch(control.owner_epoch) || control.transfer_pending !== false) throw new Error("guard_state");
  if (session && (session.token_id !== token || session.owner_epoch !== control.owner_epoch)) throw new Error("session_epoch: title changed; unlock again");
  if (params.owner_epoch !== undefined && params.owner_epoch !== control.owner_epoch) throw new Error("epoch_changed: sign again");
  return { ...params, token_id: token, owner_epoch: control.owner_epoch };
}
