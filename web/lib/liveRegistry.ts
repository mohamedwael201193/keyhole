import { OUTLAYER_OWNER } from "./config";
import { nearView } from "./rpc";

/*
 * Sources:
 * - OutLayer docs, "Projects" (https://app.outlayer.ai/docs/projects): a project's active_version is the version used
 *   for new executions by default, so it is the worker a caller reaches now. The get_project row shape parsed below
 *   (uuid, owner, project_id, active_version) is what outlayer.near returns on chain; it is observed, not documented.
 * - OutLayer docs, "TEE Attestation" (https://app.outlayer.ai/docs/tee-attestation): the attestation binds the
 *   wasm_hash (SHA256 of the exact bytes that ran), so a log is trusted only when its executed_wasm_sha256 equals
 *   the registry's active_version.
 * - NEAR RPC call_function view (https://docs.near.org/api/rpc/contracts) reads get_project on outlayer.near.
 * A failed registry read means "unknown", never a fallback to the identity.json pin.
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

/** Server-side get_project on outlayer.near. Primary RPC only (no public fallback), shared 60s cache. Throws if the view is missing or does not parse. */
export async function fetchLiveRegistry(): Promise<LiveRegistry> {
  const raw = await nearView<unknown>(
    "get_project",
    { project_id: OUTLAYER_PROJECT_ID },
    OUTLAYER_REGISTRY,
    { shared: true, timeoutMs: 12_000, primaryOnly: true },
  );
  const parsed = parseLiveRegistry(raw);
  if (!parsed) throw new Error("registry");
  return parsed;
}

/**
 * Browser-side read: goes through /api/registry so the answer comes from the server's primary RPC only,
 * then is parsed again with the same strict parser. Rejects on any non-200, malformed or foreign row.
 */
export async function fetchLiveRegistryClient(): Promise<LiveRegistry> {
  const r = await fetch("/api/registry", { cache: "no-store" });
  if (!r.ok) throw new Error("registry");
  const j = (await r.json()) as { ok?: boolean } & Record<string, unknown>;
  const parsed = j.ok === true ? parseLiveRegistry(j) : null;
  if (!parsed) throw new Error("registry");
  return parsed;
}
