import { ed25519 } from "@noble/curves/ed25519.js";
import { view, type Config } from "./near";

/** What a holder shares: the enclave-signed statement, its signature, the signer and the attested call. */
export interface PnlShare { statement: string; sig: string; minter: string; call_id: string | null }
export interface PnlStatement { kind: string; token_id: string; owner: string; trades: number; cost_usd_micro: number; value_now_usd_micro: number; pnl_usd_micro: number; since_ms: number; ts_ms: number; log_head: string; method: string }

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

export const encodeShare = (p: PnlShare) => b64url(JSON.stringify(p));
export function decodeShare(h: string): PnlShare | null {
  try {
    const j = JSON.parse(unb64url(h.replace(/^#/, ""))) as PnlShare;
    return typeof j.statement === "string" && typeof j.sig === "string" && typeof j.minter === "string" ? j : null;
  } catch { return null; }
}

const fromHex = (h: string) => Uint8Array.from((h.match(/../g) || []).map((x) => parseInt(x, 16)));

/** ed25519 over the statement bytes by the minter key (its implicit account id is the public key in hex). */
export function sigValid(p: PnlShare): boolean {
  if (!/^[0-9a-f]{64}$/.test(p.minter) || !/^[0-9a-f]{128}$/.test(p.sig)) return false;
  try { return ed25519.verify(fromHex(p.sig), new TextEncoder().encode(p.statement), fromHex(p.minter)); } catch { return false; }
}

export function parseStatement(s: string): PnlStatement | null {
  try { const j = JSON.parse(s) as PnlStatement; return j.kind === "keyhole-pnl-v1" ? j : null; } catch { return null; }
}

/** The contract names its minter; the statement must be signed by that account. */
export async function minterIsContracts(minter: string): Promise<boolean> {
  try { return (await view<Config>("config")).minter === minter; } catch { return false; }
}

export function usd(micro: number): string {
  const sign = micro < 0 ? "−" : "";
  const a = Math.abs(micro);
  return `${sign}$${(a / 1e6).toFixed(a % 10_000 === 0 ? 2 : 4)}`;
}
