import { WORKER_WASM_SHA256 } from "./config";
import { EVIDENCE_IDS } from "./evidenceIds";
export interface Attestation { call_id: string; task_id: number; task_type?: string; caller_account_id?: string | null; secrets_ref?: string | null; attached_usd?: string | number | null; executed_wasm_sha256: string; wasm_hash: string; worker_measurement: string; project_id: string; input_hash: string; output_hash: string; timestamp: number; tdx_quote: string; build_target: string }
export const CALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FASTFS = "https://main.fastfs.io";
export const fastfsUrl = (projectId: string, hash: string) => `${FASTFS}/${projectId.split("/")[0]}/outlayer.near/${hash}.wasm`;
export const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** sha256 of tee/worker/DEPLOYED_SHA256. The published build, prefix 6367401a. 67c5cd77 is the previous version. */
export const PUBLISHED_WASM_SHA256 = "6367401a78ae4f193eae16f90925968e8c3b477f1a387a213540aa0c60479693";
export const PREVIOUS_WASM_SHA256 = "67c5cd77a46814e5a4286b0a6971f8bc533274b425e7fb3272be3145469e65b2";

export interface Checks { quote: boolean; registered: boolean; published: boolean; fastfs: boolean | null; fastfsHash?: string; bytes?: number; binding?: Binding | null; output?: OutputCheck | null }
export interface Binding { expected: string; inQuote: string; match: boolean }
export interface OutputCheck { source: "evidence" | "pasted"; hash: string; match: boolean; verdict: string }

/** True when the attestation names the published worker build. */
export function publishedBuild(hash: string | undefined | null) {
  return (hash || "").toLowerCase() === PUBLISHED_WASM_SHA256;
}

/** TDX quote present, registered == executed, executed == the published build. */
export function staticChecks(a: Pick<Attestation, "executed_wasm_sha256" | "wasm_hash" | "tdx_quote">): Omit<Checks, "fastfs"> {
  const e = (a.executed_wasm_sha256 || "").toLowerCase();
  return {
    quote: (a.tdx_quote || "").length > 100,
    registered: e.length === 64 && e === (a.wasm_hash || "").toLowerCase(),
    published: publishedBuild(e),
  };
}
export async function fastfsCheck(a: Attestation): Promise<Pick<Checks, "fastfs" | "fastfsHash" | "bytes">> {
  try {
    const r = await fetch(fastfsUrl(a.project_id, a.executed_wasm_sha256));
    if (!r.ok) return { fastfs: false };
    const buf = await r.arrayBuffer();
    const h = hex(await crypto.subtle.digest("SHA-256", buf));
    return { fastfs: h === a.executed_wasm_sha256.toLowerCase(), fastfsHash: h, bytes: buf.byteLength };
  } catch { return { fastfs: null }; }
}


/** Index of the build in the published list: 0 = current, >0 = superseded, -1 = unknown. */
export function buildIndex(hash: string | undefined | null) {
  return WORKER_WASM_SHA256.indexOf((hash || "").toLowerCase());
}

/** Quote bytes from the attestation (base64 or hex). */
export function quoteBytes(q: string): Uint8Array {
  if (/^[0-9a-f]+$/i.test(q) && q.length % 2 === 0) return Uint8Array.from(q.match(/../g)!.map((h) => parseInt(h, 16)));
  const bin = atob(q);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

function i64le(n: number) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, BigInt(n), true);
  return b;
}

/** The exact bytes OutLayer hashes into TDX report_data for an execute task. */
export function reportDataPreimage(a: Attestation): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [
    enc.encode(a.task_type || "execute"), i64le(a.task_id), enc.encode(a.build_target || ""), enc.encode(a.wasm_hash || ""),
    enc.encode(a.input_hash || ""), enc.encode(a.output_hash || ""), enc.encode(a.caller_account_id || ""), enc.encode(a.project_id || ""),
    enc.encode(a.secrets_ref || ""), i64le(a.timestamp), enc.encode(String(a.attached_usd ?? "0")),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** report_data[0:32] in the TDX quote (offset 568) must equal sha256 of the attested fields. */
export async function bindingCheck(a: Attestation): Promise<Binding | null> {
  try {
    const q = quoteBytes(a.tdx_quote);
    if (q.length < 632) return null;
    const inQuote = hex(q.slice(568, 600).buffer);
    const expected = hex(await crypto.subtle.digest("SHA-256", reportDataPreimage(a) as BufferSource));
    return { expected, inQuote, match: expected === inQuote };
  } catch { return null; }
}

/** Compact JSON with sorted keys, the form the worker hashes into output_hash. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

export function outputVerdict(o: unknown): string {
  const r = o as { ok?: boolean; op?: string; error?: { code?: string } } | null;
  if (!r || typeof r !== "object") return "unknown";
  if (r.ok === false) return `refused · ${r.error?.code ?? "error"}`;
  return `ok${r.op ? ` · ${r.op}` : ""}`;
}

export async function outputCheck(a: Attestation, output: unknown, source: OutputCheck["source"]): Promise<OutputCheck> {
  const hash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(output)) as BufferSource));
  return { source, hash, match: hash === (a.output_hash || "").toLowerCase(), verdict: outputVerdict(output) };
}

/** Published worker output for a recorded evidence call, served from /evidence/<id>.json. */
export async function evidenceOutput(callId: string): Promise<unknown | null> {
  if (!EVIDENCE_IDS.has(callId)) return null;
  try {
    const r = await fetch(`/evidence/${callId}.json`);
    if (!r.ok) return null;
    const j = (await r.json()) as { output?: unknown };
    return j.output ?? null;
  } catch { return null; }
}
