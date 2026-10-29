import { NextResponse } from "next/server";
import { readSupply } from "@/lib/supply";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json({ supply: await readSupply() }, { headers: { "cache-control": "no-store" } });
}
