import {afterEach,describe,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
import {POST} from "../app/api/worker/route";
import {POST as alias} from "../app/api/keyhole/route";
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
describe("worker cutover maintenance admission",()=>{
 it("both paid aliases refuse before payment-key use, parsing, cache or upstream dispatch",async()=>{
  vi.stubEnv("KEYHOLE_MAINTENANCE","1");const upstream=vi.spyOn(globalThis,"fetch");
  for(const handler of [POST,alias])for(const body of ['{"op":"info"}','not JSON']){
   const r=await handler(new NextRequest("http://localhost/api/keyhole",{method:"POST",body}));
   expect(r.status).toBe(503);expect(r.headers.get("cache-control")).toBe("no-store");expect((await r.json()).error.code).toBe("maintenance");
  }expect(upstream).not.toHaveBeenCalled();
 });
});
