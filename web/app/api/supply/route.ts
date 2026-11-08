import { NextResponse } from "next/server";
import { readKeySupply } from "@/lib/supply";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json({ supply: await readKeySupply() }, { headers: { "cache-control": "no-store" } });
}
