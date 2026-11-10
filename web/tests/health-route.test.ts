import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/health/route";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function noSpend() {
  // Synthetic only. Even a stale enabled flag and payment key must not add a paid capability.
  vi.stubEnv("KEYHOLE_HEALTH_PROBE", "1");
  vi.stubEnv("OUTLAYER_PAYMENT_KEY", "local-test-not-a-secret");
  const fetch = vi.fn(async () => new Response(JSON.stringify({ output: { ok: true } })));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const post = (approve?: string) => {
  // Invoke through the real exported handler's HTTP signature, including untrusted old approvals.
  const handler = POST as (req: Request) => Promise<Response>;
  return handler(new NextRequest("http://localhost/api/health", { method: "POST", headers: { "x-forwarded-for": "192.0.2.11" }, body: JSON.stringify({ approve }) }));
};
async function refused(response: Response) {
  expect(response.status).toBe(405);
  expect(response.headers.get("allow")).toBe("GET");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ ok: false, error: { code: "probe_disabled" } });
}
describe("permanently passive public health", () => {
  it("GET /api/health never calls OutLayer /call, even with stale opt-in configuration", async () => {
    const fetch = noSpend();
    const response = await GET(new NextRequest("http://localhost/api/health", { headers: { "x-forwarded-for": "192.0.2.10" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: "passive", online: null, fresh: false, reason: "not_probed", payer: null });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("unauthenticated callers and the old public approval literal cannot probe", async () => {
    const fetch = noSpend();
    await refused(await post());
    await refused(await post("spend-one-info-call"));
    expect(fetch).not.toHaveBeenCalled();
  });
  it("replaying an approval cannot consume compute", async () => {
    const fetch = noSpend();
    for (let i = 0; i < 3; i++) await refused(await post("spend-one-info-call"));
    expect(fetch).not.toHaveBeenCalled();
  });
  it("concurrent callers have a permanent zero budget, not one budget per IP or instance", async () => {
    const fetch = noSpend();
    await Promise.all(Array.from({ length: 40 }, async () => refused(await post("spend-one-info-call"))));
    expect(fetch).not.toHaveBeenCalled();
  });
  it("an exhausted zero budget never refills after retries or an old flag toggle", async () => {
    const fetch = noSpend();
    for (const flag of ["0", "1", "1"]) {
      vi.stubEnv("KEYHOLE_HEALTH_PROBE", flag);
      await refused(await post("spend-one-info-call"));
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
