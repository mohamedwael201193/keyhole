import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nearView = vi.fn();
vi.mock("@/lib/rpc", () => ({ nearView: (...a: unknown[]) => nearView(...a) }));
import {
  OUTLAYER_PROJECT_ID,
  OUTLAYER_PROJECT_UUID,
  OUTLAYER_REGISTRY,
  fetchLiveRegistry,
  fetchLiveRegistryClient,
  isWorkerHash,
  parseLiveRegistry,
} from "@/lib/liveRegistry";
import { PUBLISHED_WASM_SHA256, buildIndex, currentIndex, localChecks, logVerifies, publishedBuild, staticChecks } from "@/lib/verify";

const LIVE = "34bf835cea7c9977bbd3270851eb27290dd35db4a0afa4652161664f57fc7d01";
const PREVIOUS_WASM_SHA256 = "d337e822544d31da644728ba794f444f7f3ef6c54a6ee7442ab22d07e049ae41"; // an older published build
const STALE = PUBLISHED_WASM_SHA256;
const quote = "x".repeat(200);
const att = (hash: string, registered = hash, q = quote) => ({
  executed_wasm_sha256: hash,
  wasm_hash: registered,
  tdx_quote: q,
});

const goodRow = {
  project_id: OUTLAYER_PROJECT_ID,
  uuid: OUTLAYER_PROJECT_UUID,
  owner: "keyhole-devmo.near",
  active_version: LIVE,
  created_at: 1,
};

describe("parseLiveRegistry", () => {
  it("accepts the live OutLayer get_project shape and lowercases the hash", () => {
    const r = parseLiveRegistry({ ...goodRow, active_version: LIVE.toUpperCase() });
    expect(r).toEqual({
      project_id: OUTLAYER_PROJECT_ID,
      uuid: OUTLAYER_PROJECT_UUID,
      owner: "keyhole-devmo.near",
      active_version: LIVE,
    });
  });

  it("rejects a wrong project, uuid, owner, or a non-64-hex hash", () => {
    expect(parseLiveRegistry({ ...goodRow, project_id: "other.near/keyhole" })).toBeNull();
    expect(parseLiveRegistry({ ...goodRow, uuid: "p000000000000004c" })).toBeNull();
    expect(parseLiveRegistry({ ...goodRow, owner: "other.near" })).toBeNull();
    expect(parseLiveRegistry({ ...goodRow, active_version: "62398a8a" })).toBeNull();
    expect(parseLiveRegistry({ ...goodRow, active_version: "g".repeat(64) })).toBeNull();
    expect(parseLiveRegistry(null)).toBeNull();
    expect(parseLiveRegistry([])).toBeNull();
    expect(parseLiveRegistry("x")).toBeNull();
    expect(parseLiveRegistry({ ...goodRow, active_version: "0".repeat(63) + "\n" })).toBeNull();
  });

  it("pins the UUID to the protocol file and the registry contract name", () => {
    const proto = JSON.parse(readFileSync(`${__dirname}/../../protocol/legacy-worker-versions.json`, "utf8"));
    expect(OUTLAYER_PROJECT_UUID).toBe(proto.project_uuid);
    expect(OUTLAYER_PROJECT_ID).toBe(proto.project_id);
    expect(OUTLAYER_REGISTRY).toBe("outlayer.near");
    expect(isWorkerHash(LIVE)).toBe(true);
    expect(isWorkerHash(STALE)).toBe(true);
    expect(isWorkerHash("62398a8a")).toBe(false);
  });
});

describe("logVerifies against a live registry hash", () => {
  it("passes when the executed build is the live hash, registered, and quoted", () => {
    expect(logVerifies(att(LIVE), LIVE)).toBe(true);
    expect(staticChecks(att(LIVE), LIVE)).toEqual({ quote: true, registered: true, published: true });
    expect(publishedBuild(LIVE, LIVE)).toBe(true);
  });

  it("fails closed on the stale identity pin, a missing expected hash, or a broken attestation", () => {
    // This is the production bug: a fresh call on 34bf835c was compared only to identity.json's 62398a8a.
    expect(publishedBuild(LIVE)).toBe(false);
    expect(logVerifies(att(LIVE), STALE)).toBe(false);
    expect(logVerifies(att(STALE), LIVE)).toBe(false);
    expect(logVerifies(att(LIVE), null)).toBe(false);
    expect(logVerifies(att(LIVE), undefined)).toBe(false);
    expect(logVerifies(att(LIVE), "short")).toBe(false);
    expect(logVerifies(att(LIVE, "b".repeat(64)), LIVE)).toBe(false);
    expect(logVerifies(att(LIVE, LIVE, "short"), LIVE)).toBe(false);
    expect(logVerifies(att(PREVIOUS_WASM_SHA256), LIVE)).toBe(false);
  });

  it("indexes against the live hash: live is current, the identity pin and history are previous", () => {
    expect(currentIndex(LIVE, LIVE)).toBe(0);
    expect(currentIndex(STALE, LIVE)).toBeGreaterThan(0);
    expect(currentIndex(PREVIOUS_WASM_SHA256, LIVE)).toBeGreaterThan(0);
    expect(currentIndex("f".repeat(64), LIVE)).toBe(-1);
  });

  it("never fails open: a failed live read is unknown, not the identity pin", () => {
    expect(currentIndex(STALE, null)).toBe(-1);
    expect(currentIndex(PREVIOUS_WASM_SHA256, undefined)).toBe(-1);
    expect(currentIndex(STALE, "short")).toBe(-1);
    expect(publishedBuild(STALE, null)).toBe(false);
    expect(staticChecks(att(STALE), null).published).toBe(false);
    // identity-only helpers keep their documented behaviour for docs and historical proofs.
    expect(buildIndex(STALE)).toBe(0);
    expect(publishedBuild(STALE)).toBe(true);
  });

  it("localChecks takes the live hash, so a tamper isolates one check", async () => {
    const ck = await localChecks(att(LIVE) as never, undefined, LIVE);
    expect(ck.published).toBe(true);
    expect((await localChecks(att(LIVE) as never, undefined, null)).published).toBe(false);
    expect((await localChecks(att(STALE) as never, undefined, LIVE)).published).toBe(true); // previous build is genuine
  });
});

describe("fetchLiveRegistry (server read)", () => {
  beforeEach(() => { nearView.mockClear(); });
  it("returns a good row and asks the primary RPC only", async () => {
    nearView.mockResolvedValue(goodRow);
    await expect(fetchLiveRegistry()).resolves.toMatchObject({ active_version: LIVE });
    expect(nearView).toHaveBeenCalledWith("get_project", { project_id: OUTLAYER_PROJECT_ID }, OUTLAYER_REGISTRY, expect.objectContaining({ primaryOnly: true }));
  });
  it("rejects a wrong owner", async () => {
    nearView.mockResolvedValue({ ...goodRow, owner: "evil.near" });
    await expect(fetchLiveRegistry()).rejects.toThrow("registry");
  });
  it("rejects when the RPC throws", async () => {
    nearView.mockImplementation(async () => { throw new Error("rpc"); });
    await expect(fetchLiveRegistry()).rejects.toThrow("rpc");
  });
});

describe("fetchLiveRegistryClient (via /api/registry)", () => {
  const reply = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
  it("accepts the route's ok body and rejects 429, 503 and foreign rows", async () => {
    reply(200, { ok: true, ...goodRow });
    await expect(fetchLiveRegistryClient()).resolves.toMatchObject({ active_version: LIVE });
    reply(429, { ok: false });
    await expect(fetchLiveRegistryClient()).rejects.toThrow();
    reply(503, { ok: false });
    await expect(fetchLiveRegistryClient()).rejects.toThrow();
    reply(200, { ok: true, ...goodRow, owner: "evil.near" });
    await expect(fetchLiveRegistryClient()).rejects.toThrow();
    reply(200, { ok: false });
    await expect(fetchLiveRegistryClient()).rejects.toThrow();
  });
});

describe("GET /api/registry", () => {
  beforeEach(() => { nearView.mockReset(); vi.resetModules(); });
  const req = (ip = "9.9.9.1") => new Request("http://x/api/registry", { headers: { "x-real-ip": ip } });
  it("200 with a good row, 503 no-store when the read fails, 429 past the limit", async () => {
    const { GET } = await import("@/app/api/registry/route");
    nearView.mockResolvedValue(goodRow);
    const ok = await GET(req());
    expect(ok.status).toBe(200);
    expect((await ok.json()).active_version).toBe(LIVE);
    nearView.mockImplementation(async () => { throw new Error("rpc"); });
    const bad = await GET(req("9.9.9.2"));
    expect(bad.status).toBe(503);
    expect(bad.headers.get("cache-control")).toBe("no-store");
    nearView.mockResolvedValue(goodRow);
    let last = 200;
    for (let i = 0; i < 40; i++) last = (await GET(req("9.9.9.3"))).status;
    expect(last).toBe(429);
  });
});
