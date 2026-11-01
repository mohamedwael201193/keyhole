/** Private assistant on NEAR AI Cloud: a TEE-hosted model whose attestation is bound to a nonce the browser makes. */
import { recoverMessageAddress } from "viem";

/** NEAR-operated (owned_by "nearai") model with an Intel TDX + NVIDIA attestation report. Cheap and fast. */
export const AI_MODEL = "Qwen/Qwen3.6-35B-A3B-FP8";
export const AI_MAX_PROMPT = 400;
export const AI_MAX_TOKENS = 350;
export const NONCE_RE = /^[0-9a-f]{64}$/;

export interface AiReply {
  ok: true;
  model: string;
  request_body: string;
  response_body: string;
  signature: { text: string; signature: `0x${string}`; signing_address: string; signing_algo: string };
  attestation: { nonce: string; request_nonce: string; signing_address: string; signing_algo: string; intel_quote: string; gpu_evidence: boolean; model_name: string };
}

export interface AiChecks {
  nonceInQuote: boolean;
  signerInQuote: boolean;
  nonceEcho: boolean;
  requestHash: boolean;
  responseHash: boolean;
  modelMatch: boolean;
  signatureValid: boolean;
  recovered: string | null;
}

const hexOf = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
async function sha256Hex(s: string) {
  return hexOf(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s) as BufferSource)));
}

export function newNonce(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return hexOf(b);
}

/** TDX quote report_data is at byte 568..632: [0:32] signer (zero-padded), [32:64] the client nonce. */
export function reportData(quoteHex: string): { signer: string; nonce: string } | null {
  const q = quoteHex.replace(/^0x/, "");
  if (!/^[0-9a-f]+$/i.test(q) || q.length < 632 * 2) return null;
  const rd = q.slice(568 * 2, 632 * 2).toLowerCase();
  return { signer: rd.slice(0, 64), nonce: rd.slice(64) };
}

/** Every check runs in the browser against the nonce this browser generated. */
export async function checkReply(r: AiReply, nonce: string): Promise<AiChecks> {
  const rd = reportData(r.attestation.intel_quote);
  const addr = r.attestation.signing_address.toLowerCase().replace(/^0x/, "");
  const [model, reqH, resH] = r.signature.text.split(":");
  let recovered: string | null = null;
  try { recovered = (await recoverMessageAddress({ message: r.signature.text, signature: r.signature.signature })).toLowerCase(); } catch { recovered = null; }
  return {
    nonceInQuote: !!rd && rd.nonce === nonce,
    signerInQuote: !!rd && rd.signer === addr.padEnd(64, "0"),
    nonceEcho: r.attestation.request_nonce === nonce,
    requestHash: reqH === (await sha256Hex(r.request_body)),
    responseHash: resH === (await sha256Hex(r.response_body)),
    modelMatch: model === r.model && r.attestation.model_name === r.model,
    signatureValid: recovered === `0x${addr}` && r.signature.signing_address.toLowerCase() === `0x${addr}`,
    recovered,
  };
}

export const allPass = (c: AiChecks) => c.nonceInQuote && c.signerInQuote && c.nonceEcho && c.requestHash && c.responseHash && c.modelMatch && c.signatureValid;

/** The answer text, read from the exact signed response bytes. */
export function answerOf(r: AiReply): string {
  try {
    const j = JSON.parse(r.response_body) as { choices?: { message?: { content?: string } }[] };
    return (j.choices?.[0]?.message?.content || "").trim();
  } catch { return ""; }
}
