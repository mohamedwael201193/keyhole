import {PLEDGE_SANDBOX} from "@/lib/config";
import {NextResponse} from "next/server";
import {sandboxProxy} from "@/lib/sandboxProxy";
export const dynamic="force-dynamic";
export async function POST(req:Request){if(!PLEDGE_SANDBOX)return NextResponse.json({error:{code:"not_found"}},{status:404});const text=await req.text();if(text.length>16384)return NextResponse.json({error:{code:"too_large"}},{status:413});try{const body=JSON.parse(text);return sandboxProxy(req,body.action,body);}catch{return NextResponse.json({error:{code:"bad_body"}},{status:400});}}
