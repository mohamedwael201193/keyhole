import { OUTLAYER_OWNER } from "./config";
import { nearView } from "./rpc";

/*
 * Source of truth: OutLayer docs, "TEE Attestation" > "What the Signature Proves": the attestation binds the
 * wasm_hash (SHA256 of the exact bytes that ran) and trust follows that hash, so a log verifies only when the
 * enclave's executed_wasm_sha256 equals the project's active_version on outlayer.near (get_project, a public
 * NEAR RPC call_function view). identity.json is the offline fallback and is never silently preferred over a live read.
 */
/** OutLayer registry contract and the KEYHOLE project it lists. Not env-overridable. */
export const OUTLAYER_REGISTRY = "outlayer.near";
export const OUTLAYER_PROJECT_ID = "keyhole-devmo.near/keyhole";
/** Stable project UUID. Cross-checked against protocol/legacy-worker-versions.json in tests. */
export const OUTLAYER_PROJECT_UUID = "p000000000000004b";
export const WORKER_HASH_RE = /^[0-9a-f]{64}$/;

export type LiveRegistry = {
  project_id: string;
  uuid: string;
  active_version: string;
  owner: string;
};

export function isWorkerHash(h: string | undefined | null): h is string {
  return typeof h === "string" && WORKER_HASH_RE.test(h.toLowerCase());
}

/**
 * Accept a get_project view only when it is this project's current registry row:
 * owner, project id, pinned UUID, and a 64-hex active_version. Anything else is rejected.
 */
export function parseLiveRegistry(raw: unknown): LiveRegistry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const project_id = typeof o.project_id === "string" ? o.project_id : "";
  const uuid = typeof o.uuid === "string" ? o.uuid : "";
  const owner = typeof o.owner === "string" ? o.owner : "";
  const active_version = typeof o.active_version === "string" ? o.active_version.toLowerCase() : "";
  if (project_id !== OUTLAYER_PROJECT_ID) return null;
  if (uuid !== OUTLAYER_PROJECT_UUID) return null;
  if (owner !== OUTLAYER_OWNER) return null;
  if (!WORKER_HASH_RE.test(active_version)) return null;
  return { project_id, uuid, owner, active_version };
}

/** Public get_project on outlayer.near. Shared 60s RPC cache. Throws if the view is missing or does not parse. */
export async function fetchLiveRegistry(): Promise<LiveRegistry> {
  const raw = await nearView<unknown>(
    "get_project",
    { project_id: OUTLAYER_PROJECT_ID },
    OUTLAYER_REGISTRY,
    { shared: true, timeoutMs: 12_000 },
  );
  const parsed = parseLiveRegistry(raw);
  if (!parsed) throw new Error("registry");
  return parsed;
}
