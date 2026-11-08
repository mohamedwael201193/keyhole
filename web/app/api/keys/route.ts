import { NextResponse } from "next/server";
import { nearView } from "@/lib/rpc";
import { KEYS_CONTRACT } from "@/lib/config";
import type { Token } from "@/lib/near";
import { AccountCache, KEY_LIST_LIMIT, KEYS_RPC_TIMEOUT_MS, validAccountId } from "@/lib/keysApi";

// The keys an account holds and the tier of its first key, read on the server so the first visit does not wait for the
// browser to reach NEAR RPC. Public contract reads only: no signature, no session. Answers are cached per account for 15 s.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };
type KeysBody = { keys: Token[]; tier: number | null };
const cache = new AccountCache<KeysBody>();

export async function GET(req: Request) {
  const account = new URL(req.url).searchParams.get("account");
  if (!validAccountId(account)) {
    return NextResponse.json({ error: "A NEAR account id is needed." }, { status: 400, headers: noStore });
  }
  const now = Date.now();
  const hit = cache.get(account, now);
  if (hit) return NextResponse.json(hit, { headers: noStore });
  try {
    const keys = await nearView<Token[]>("nft_tokens_for_owner", { account_id: account, from_index: "0", limit: KEY_LIST_LIMIT }, KEYS_CONTRACT, { timeoutMs: KEYS_RPC_TIMEOUT_MS });
    const tier = keys[0]
      ? await nearView<number | null>("nft_tier", { token_id: keys[0].token_id }, KEYS_CONTRACT, { timeoutMs: KEYS_RPC_TIMEOUT_MS }).catch(() => null)
      : null;
    const body: KeysBody = { keys, tier };
    cache.set(account, body, now);
    return NextResponse.json(body, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "NEAR mainnet did not answer." }, { status: 502, headers: noStore });
  }
}
