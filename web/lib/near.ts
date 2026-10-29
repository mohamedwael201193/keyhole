import { KEYS_CONTRACT, RPC_URL } from "./config";

export interface TokenMetadata { title: string | null; description: string | null; expires_at: string | null; issued_at: string | null }
export interface Token { token_id: string; owner_id: string; metadata: TokenMetadata | null }
export interface Config { owner: string; minter: string; treasury: string; royalty_bps: number; beats: string }

export async function view<T>(method: string, args: Record<string, unknown> = {}, contract = KEYS_CONTRACT): Promise<T> {
  const args_base64 = typeof btoa === "function" ? btoa(JSON.stringify(args)) : Buffer.from(JSON.stringify(args)).toString("base64");
  const r = await fetch(RPC_URL, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "kh", method: "query",
      params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64 } }),
    next: { revalidate: 15 },
  } as RequestInit);
  const j = await r.json();
  if (j.error || j.result?.error) throw new Error(j.error?.cause?.name || j.result?.error || "rpc");
  return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result))) as T;
}

export const nftTokens = (from = 0, limit = 50) => view<Token[]>("nft_tokens", { from_index: String(from), limit });
export const nftToken = (id: string) => view<Token | null>("nft_token", { token_id: id });
export const nftTier = (id: string) => view<number | null>("nft_tier", { token_id: id });
export const nftSupply = () => view<string>("nft_total_supply");
export const contractConfig = () => view<Config>("config");
export const tokensFor = (account_id: string) => view<Token[]>("nft_tokens_for_owner", { account_id, from_index: "0", limit: 10 });

export type KeyState = "locked" | "unlocked" | "expired" | "legendary";
/**
 * Visual state of a key, derived only from on-chain data and the connected viewer:
 *  - legendary: tier 3 (reserved; no tier-3 key exists today)
 *  - expired:   metadata.expires_at (ms) is in the past
 *  - unlocked:  the connected wallet owns the token
 *  - locked:    anyone else looking at it
 */
export function keyState(t: Pick<Token, "owner_id" | "metadata">, tier: number | null, viewer: string | null, now = Date.now()): KeyState {
  if (tier === 3) return "legendary";
  const exp = t.metadata?.expires_at ? Number(t.metadata.expires_at) : NaN;
  if (Number.isFinite(exp) && exp < now) return "expired";
  if (viewer && viewer === t.owner_id) return "unlocked";
  return "locked";
}

export const tierName = (t: number | null | undefined) => (t === 1 ? "Bronze" : t === 2 ? "Silver" : t === 3 ? "Gold" : "—");

/** Truncate the middle of 64-hex implicit accounts; keep named accounts whole when short. */
export function shortAccount(a: string, keep = 6): string {
  if (/^[0-9a-f]{64}$/.test(a)) return `${a.slice(0, keep)}…${a.slice(-keep)}`;
  return a.length > 28 ? `${a.slice(0, 14)}…${a.slice(-10)}` : a;
}
