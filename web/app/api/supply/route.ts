import { NextResponse } from "next/server";
import { readHolderSupply } from "@/lib/supply";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const snap = await readHolderSupply();
  return NextResponse.json(snap ?? { supply: null, minted: null, excluded_test_keys: null, block_hash: null }, { headers: { "cache-control": "no-store" } });
}
