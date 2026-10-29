import { NextResponse } from "next/server";
import { tokenPrices } from "@/lib/tokenPrices";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json({ prices: await tokenPrices() }, { headers: { "cache-control": "no-store" } });
}
