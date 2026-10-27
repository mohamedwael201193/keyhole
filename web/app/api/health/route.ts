import { NextResponse } from "next/server";
import { getHealth } from "@/lib/health";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() { return NextResponse.json(await getHealth(), { headers: { "cache-control": "no-store" } }); }
