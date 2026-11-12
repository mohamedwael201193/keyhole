import { NextResponse } from "next/server";
import { readMainnetStats } from "@/lib/mainnetStats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Live mainnet counts. A failed read is "unavailable", never a previous snapshot. */
export async function GET() {
  const stats = await readMainnetStats();
  return NextResponse.json(stats, { headers: { "cache-control": "no-store" } });
}
