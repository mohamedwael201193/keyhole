export interface Attestation { call_id: string; executed_wasm_sha256: string; wasm_hash: string; worker_measurement: string; project_id: string; input_hash: string; output_hash: string; timestamp: number; tdx_quote: string; build_target: string }
export const CALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FASTFS = "https://main.fastfs.io";
export const fastfsUrl = (projectId: string, hash: string) => `${FASTFS}/${projectId.split("/")[0]}/outlayer.near/${hash}.wasm`;
export const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export interface Checks { quote: boolean; registered: boolean; fastfs: boolean | null; fastfsHash?: string; bytes?: number }
/** Same three checks as verify.sh: TDX quote present, registered == executed, FastFS bytes hash == executed. */
export function staticChecks(a: Pick<Attestation, "executed_wasm_sha256" | "wasm_hash" | "tdx_quote">): Omit<Checks, "fastfs"> {
  const e = (a.executed_wasm_sha256 || "").toLowerCase();
  return { quote: (a.tdx_quote || "").length > 100, registered: e.length === 64 && e === (a.wasm_hash || "").toLowerCase() };
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
