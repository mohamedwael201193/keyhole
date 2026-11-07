import { NextResponse } from "next/server";
import { readHolderKeys } from "@/lib/supply";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json({ supply: await readHolderKeys() }, { headers: { "cache-control": "no-store" } });
}
