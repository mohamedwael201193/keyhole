/** TLA-style pair check: an OFF-CHAIN consistency check, not on-chain verification.
 *  Both reads (`nft_token` and `nft_tokens_for_owner`/`holder_tier`) are pinned to one final block height,
 *  so a transfer landing between the two reads cannot make them disagree. */
export type PairRead = { block: number; tokenOwner: string | null; ownerTokens: string[]; holderTier: number | null };
export type PairResult = { ok: boolean; reasons: string[] };

export function pairCheck(tokenId: string, r: PairRead, readBlocks: number[]): PairResult {
  const reasons: string[] = [];
  if (!readBlocks.length || readBlocks.some((b) => b !== r.block)) reasons.push("reads not pinned to one block");
  if (!r.tokenOwner) reasons.push("token does not exist at this block");
  else {
    if (!r.ownerTokens.includes(tokenId)) reasons.push("owner's token list does not include the token");
    if (r.holderTier == null) reasons.push("owner has no holder tier");
  }
  return { ok: reasons.length === 0, reasons };
}

const RPC = "https://rpc.mainnet.near.org";
async function view(contract: string, method: string, args: object, block: number, f: typeof fetch) {
  const r = await f(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", block_id: block, account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }) });
  const j = await r.json();
  if (j.error || j.result?.error) throw new Error("rpc");
  return { block: j.result.block_height as number, value: JSON.parse(Buffer.from(j.result.result).toString()) };
}

/** Reads the pair live at one final block. */
export async function readPair(contract: string, tokenId: string, f: typeof fetch = fetch): Promise<{ read: PairRead; blocks: number[] }> {
  const b = await f(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "block", params: { finality: "final" } }) });
  const block = (await b.json()).result.header.height as number;
  const t = await view(contract, "nft_token", { token_id: tokenId }, block, f);
  const owner = (t.value?.owner_id as string) ?? null;
  if (!owner) return { read: { block, tokenOwner: null, ownerTokens: [], holderTier: null }, blocks: [t.block] };
  const [ts, tier] = await Promise.all([
    view(contract, "nft_tokens_for_owner", { account_id: owner, limit: 100 }, block, f),
    view(contract, "holder_tier", { account_id: owner }, block, f),
  ]);
  return { read: { block, tokenOwner: owner, ownerTokens: (ts.value as { token_id: string }[]).map((x) => x.token_id), holderTier: tier.value ?? null }, blocks: [t.block, ts.block, tier.block] };
}
