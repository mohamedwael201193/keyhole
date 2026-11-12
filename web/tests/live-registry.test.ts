import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OUTLAYER_PROJECT_ID,
  OUTLAYER_PROJECT_UUID,
  OUTLAYER_REGISTRY,
  isWorkerHash,
  parseLiveRegistry,
} from "@/lib/liveRegistry";
import { PREVIOUS_WASM_SHA256, PUBLISHED_WASM_SHA256, buildIndex, logVerifies, publishedBuild, staticChecks } from "@/lib/verify";

const LIVE = "34bf835cea7c9977bbd3270851eb27290dd35db4a0afa4652161664f57fc7d01";
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

  it("treats the live hash as current and the identity pin as superseded once the registry is known", () => {
    expect(buildIndex(LIVE, LIVE)).toBe(0);
    expect(buildIndex(STALE, LIVE)).toBeGreaterThan(0);
    expect(buildIndex(PREVIOUS_WASM_SHA256, LIVE)).toBeGreaterThan(0);
    expect(buildIndex("f".repeat(64), LIVE)).toBe(-1);
    // Without a live hash the identity list is unchanged, so historical proofs stay indexed.
    expect(buildIndex(STALE)).toBe(0);
    expect(buildIndex(PREVIOUS_WASM_SHA256)).toBeGreaterThan(0);
  });
});
