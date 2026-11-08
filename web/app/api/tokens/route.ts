import { NextResponse } from "next/server";
import { fetchTokenList, type Token } from "@/lib/tokenList";

// The 1Click token list, cached here for 300 s. Only a successful read is cached, so an upstream failure is
// reported as 502 on the next request instead of being held for five minutes.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_MS = 300_000;
let memo: { at: number; tokens: Token[] } | null = null;

export async function GET() {
  if (memo && Date.now() - memo.at < TTL_MS) return ok(memo.tokens);
  const r = await fetchTokenList();
  if (!r.ok) {
    return NextResponse.json({ error: "The token list is unavailable right now. Try again in a moment." }, { status: 502, headers: { "cache-control": "no-store" } });
  }
  memo = { at: Date.now(), tokens: r.tokens };
  return ok(r.tokens);
}

function ok(tokens: Token[]) {
  return NextResponse.json({ tokens, count: tokens.length }, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=300" } });
}
