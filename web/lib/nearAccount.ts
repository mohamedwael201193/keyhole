import { NEAR_RPCS } from "./rpc";

export type AccountState = { exists: boolean; yocto: bigint };

/** view_account over JSON-RPC (docs.near.org/api/rpc/contracts#view-account). UNKNOWN_ACCOUNT = not on chain yet. */
export async function accountState(id: string, urls: string[] = NEAR_RPCS): Promise<AccountState | null> {
  for (const url of urls) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8_000),
        body: JSON.stringify({ jsonrpc: "2.0", id: "kh", method: "query", params: { request_type: "view_account", finality: "final", account_id: id } }) });
      const j = await r.json();
      const name = j?.error?.cause?.name || "";
      if (name === "UNKNOWN_ACCOUNT" || /does not exist/i.test(String(j?.error?.data ?? j?.result?.error ?? ""))) return { exists: false, yocto: BigInt(0) };
      if (typeof j?.result?.amount === "string") return { exists: true, yocto: BigInt(j.result.amount) };
    } catch { /* next RPC */ }
  }
  return null;
}

/** yoctoNEAR -> "1.2345" (4 decimals, truncated). */
export function formatNear(yocto: bigint): string {
  const s = yocto.toString().padStart(25, "0");
  const whole = s.slice(0, -24).replace(/^0+(?=\d)/, "");
  return `${whole}.${s.slice(-24, -20)}`;
}
