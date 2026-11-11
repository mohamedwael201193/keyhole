import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/agent/route";
import { missingAgentEnv } from "@/lib/agentApi";

const AGENT = "ab".repeat(32);
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function req(r: string, ip: string) {
  return new Request(`http://localhost/api/agent?r=${r}`, { headers: { "x-forwarded-for": ip } });
}

describe("missingAgentEnv names the unset variable and never a value", () => {
  it("names each missing variable", () => {
    expect(missingAgentEnv({}, "quotas")).toEqual(["AGENT_API_BASE_URL", "AGENT_API_KEY"]);
    expect(missingAgentEnv({ base: "https://example.test", key: "present" }, "policy")).toEqual(["AGENT_API_AGENT_ID"]);
    expect(missingAgentEnv({ base: "https://example.test", key: "present", agent: AGENT }, "policy")).toEqual([]);
  });
});

describe("GET /api/agent", () => {
  it("returns the missing env names when the bridge is not configured", async () => {
    vi.stubEnv("AGENT_API_BASE_URL", "");
    vi.stubEnv("AGENT_API_KEY", "");
    vi.stubEnv("AGENT_API_AGENT_ID", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const res = await GET(req("quotas", "192.0.2.21"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: { code: "config", missing: ["AGENT_API_BASE_URL", "AGENT_API_KEY"] } });
    expect(JSON.stringify(body)).not.toMatch(/sk-|secret|Bearer/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("turns a non-200 upstream into a clean 200, and keeps the status code", async () => {
    vi.stubEnv("AGENT_API_BASE_URL", "https://agent.example.test");
    vi.stubEnv("AGENT_API_KEY", "test-key-not-a-secret");
    vi.stubEnv("AGENT_API_AGENT_ID", AGENT);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).endsWith("/v1/network")) return new Response(JSON.stringify({ network: "mainnet", status: { overall: "operational" } }), { status: 200 });
      return new Response("no", { status: 404 });
    }));
    const quotas = await GET(req("quotas", "192.0.2.22"));
    expect(quotas.status).toBe(200);
    expect(await quotas.json()).toEqual({ ok: false, error: { code: "upstream", upstream_status: 404 } });
    const network = await GET(req("network", "192.0.2.22"));
    expect(network.status).toBe(200);
    expect((await network.json()).ok).toBe(true);
    const policy = await GET(req("policy", "192.0.2.23"));
    expect(policy.status).toBe(200);
    expect(await policy.json()).toEqual({ ok: false, error: { code: "upstream", upstream_status: 404 } });
  });

  it("names a timeout without a 502", async () => {
    vi.stubEnv("AGENT_API_BASE_URL", "https://agent.example.test");
    vi.stubEnv("AGENT_API_KEY", "test-key-not-a-secret");
    vi.stubEnv("AGENT_API_AGENT_ID", AGENT);
    vi.stubGlobal("fetch", vi.fn(async () => { const e = new Error("timed out"); e.name = "TimeoutError"; throw e; }));
    const res = await GET(req("quotas", "192.0.2.24"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: { code: "timeout" } });
  });
});
