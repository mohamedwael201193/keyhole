import {NextResponse} from "next/server";
import {PLEDGE_SANDBOX} from "./config";
/** Fixed loopback test server only. Never accepts URLs, receivers or credentials as configuration. */
export async function sandboxProxy(req:Request,action:string,body:unknown){
 if(!PLEDGE_SANDBOX||!["127.0.0.1","localhost"].includes(new URL(req.url).hostname)||!["metadata","tx","sign","worker","advance","policy"].includes(action))return NextResponse.json({error:{code:"not_found"}},{status:404});
 const origin=req.headers.get("origin");if(origin&&!["127.0.0.1","localhost"].includes(new URL(origin).hostname))return NextResponse.json({error:{code:"origin"}},{status:403});
 try{const r=await fetch(`http://127.0.0.1:3144/${action}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),cache:"no-store",signal:AbortSignal.timeout(55000)});return NextResponse.json(await r.json(),{headers:{"cache-control":"no-store"}});}catch{return NextResponse.json({error:{code:"sandbox_unavailable"}},{status:503});}
}
