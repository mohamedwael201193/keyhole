// KEYHOLE client core: NEP-413 signing, worker calls, attestation verification.
// Works for any NEAR account. No secrets leave your machine; only signatures are sent.
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes } from "@noble/hashes/utils";
import bs58 from "bs58";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const NEP413_TAG = 2147484061;
export const DEFAULTS = {
  project: process.env.KEYHOLE_PROJECT ?? "keyhole-devmo.near/keyhole",
  recipient: process.env.KEYHOLE_RECIPIENT ?? "keyhole",
  outlayer: process.env.OUTLAYER_API ?? "https://api.outlayer.ai",
  fastfs: process.env.FASTFS_BASE ?? "https://main.fastfs.io",
  rpc: process.env.NEAR_RPC ?? "https://rpc.mainnet.near.org",
};

export interface Key { accountId: string; secret: Uint8Array; publicKey: string }
export interface Auth { account_id: string; public_key: string; signature: string; nonce: string; message: string; recipient: string }

/** ed25519:<base58 64-byte or 32-byte secret> -> Key */
export function keyFromString(accountId: string, privateKey: string): Key {
  const raw = bs58.decode(privateKey.replace(/^ed25519:/, ""));
  if (raw.length !== 64 && raw.length !== 32) throw new Error("private key must be ed25519 (32 or 64 bytes, base58)");
  const secret = raw.slice(0, 32);
  return { accountId, secret, publicKey: "ed25519:" + bs58.encode(ed25519.getPublicKey(secret)) };
}

/** Key from env (KEYHOLE_ACCOUNT + KEYHOLE_PRIVATE_KEY), a JSON key file, or ~/.near-credentials/mainnet/<account>.json */
export function loadKey(opts: { account?: string; keyFile?: string } = {}): Key {
  const account = opts.account ?? process.env.KEYHOLE_ACCOUNT;
  if (process.env.KEYHOLE_PRIVATE_KEY && account) return keyFromString(account, process.env.KEYHOLE_PRIVATE_KEY);
  const file = opts.keyFile ?? process.env.KEYHOLE_KEY_FILE ?? (account ? join(homedir(), ".near-credentials", "mainnet", `${account}.json`) : undefined);
  if (!file || !existsSync(file)) throw new Error("no key: set KEYHOLE_ACCOUNT and KEYHOLE_PRIVATE_KEY, or --key-file, or log in with near-cli (~/.near-credentials/mainnet/<account>.json)");
  const j = JSON.parse(readFileSync(file, "utf8"));
  return keyFromString(j.account_id ?? account, j.private_key ?? j.secret_key);
}

function borshString(s: string): Uint8Array {
  const b = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + b.length);
  new DataView(out.buffer).setUint32(0, b.length, true);
  out.set(b, 4);
  return out;
}
const concat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

/** Exact NEP-413 bytes: borsh(u32 tag) || borsh(message) || nonce[32] || borsh(recipient) || option(callbackUrl)=None */
export function nep413Bytes(message: string, nonce: Uint8Array, recipient: string): Uint8Array {
  const tag = new Uint8Array(4); new DataView(tag.buffer).setUint32(0, NEP413_TAG, true);
  return concat(tag, borshString(message), nonce, borshString(recipient), new Uint8Array([0]));
}

export function signRequest(key: Key, op: string, params: Record<string, unknown> = {}, recipient = DEFAULTS.recipient, nowMs = Date.now()): Auth {
  const message = JSON.stringify({ op, account_id: key.accountId, ts_ms: nowMs, params });
  const nonce = randomBytes(32);
  const sig = ed25519.sign(sha256(nep413Bytes(message, nonce, recipient)), key.secret);
  const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
  return { account_id: key.accountId, public_key: key.publicKey, signature: b64(sig), nonce: b64(nonce), message, recipient };
}

export interface CallResult { call_id?: string; output: any; attestation_url?: string }

/**
 * Send {op, auth} to the worker. Route:
 *  - KEYHOLE_GATEWAY (e.g. the website's /api/keyhole): POST {op, auth} -> worker reply (gateway pays OutLayer)
 *  - else OUTLAYER_PAYMENT_KEY: call OutLayer directly with your own payment key
 */
export async function callWorker(input: { op: string; auth?: Auth }): Promise<CallResult> {
  const gw = process.env.KEYHOLE_GATEWAY;
  if (gw) {
    const r = await fetch(gw, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    const j: any = await r.json();
    return { call_id: j.call_id, output: j.output ?? j, attestation_url: j.attestation_url };
  }
  const pk = process.env.OUTLAYER_PAYMENT_KEY;
  if (!pk) throw new Error("set KEYHOLE_GATEWAY (hosted) or OUTLAYER_PAYMENT_KEY (your own OutLayer payment key)");
  const r = await fetch(`${DEFAULTS.outlayer}/call/${DEFAULTS.project}`, {
    method: "POST", headers: { "X-Payment-Key": pk, "content-type": "application/json" },
    body: JSON.stringify({ input, async: false, secrets_ref: { profile: "default", account_id: DEFAULTS.project.split("/")[0] } }),
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`OutLayer ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return { call_id: j.call_id, output: j.output, attestation_url: j.attestation_url };
}

export async function run(key: Key | null, op: string, params: Record<string, unknown> = {}): Promise<CallResult> {
  return callWorker(key ? { op, auth: signRequest(key, op, params) } : { op });
}

export const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");
export const sha256Hex = (u: Uint8Array) => hex(sha256(u));

export interface Verification { ok: boolean; call_id: string; project?: string; attested_sha256?: string; fastfs_url?: string; fastfs_sha256?: string; local_sha256?: string; tdx_quote_present: boolean; checks: string[] }

/** Attestation -> executed_wasm_sha256; FastFS bytes -> sha256; optional local build -> sha256. All must match. */
export async function verifyCall(callId: string, localWasm?: string): Promise<Verification> {
  const checks: string[] = [];
  const a: any = await (await fetch(`${DEFAULTS.outlayer}/attestations/by-call/${callId}`)).json();
  const att = a.executed_wasm_sha256 ?? a.wasm_hash;
  const v: Verification = { ok: false, call_id: callId, project: a.project_id, attested_sha256: att, tdx_quote_present: typeof a.tdx_quote === "string" && a.tdx_quote.length > 100, checks };
  if (!att) { checks.push("FAIL attestation has no wasm hash"); return v; }
  checks.push(`${v.tdx_quote_present ? "OK" : "FAIL"} TDX quote present`);
  checks.push(`${a.wasm_hash === a.executed_wasm_sha256 ? "OK" : "FAIL"} registered wasm_hash == executed_wasm_sha256`);
  const owner = String(a.project_id ?? "").split("/")[0];
  v.fastfs_url = `${DEFAULTS.fastfs}/${owner}/outlayer.near/${att}.wasm`;
  const r = await fetch(v.fastfs_url);
  if (r.ok) { v.fastfs_sha256 = sha256Hex(new Uint8Array(await r.arrayBuffer())); checks.push(`${v.fastfs_sha256 === att ? "OK" : "FAIL"} FastFS bytes sha256 == attested`); }
  else checks.push(`FAIL FastFS fetch ${r.status}`);
  if (localWasm) { v.local_sha256 = sha256Hex(readFileSync(localWasm)); checks.push(`${v.local_sha256 === att ? "OK" : "FAIL"} local build sha256 == attested`); }
  v.ok = checks.every((c) => c.startsWith("OK"));
  return v;
}

/** Human summary of the encrypted trade log (amounts in base units -> decimals for known tokens). */
const DECIMALS: Record<string, [string, number]> = {
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": ["USDC", 6],
  "nep141:wrap.near": ["wNEAR", 24],
};
export function fmt(token: string, amount: string | null | undefined): string {
  const [sym, d] = DECIMALS[token] ?? [token.replace(/^nep141:/, ""), 0];
  if (amount == null) return `? ${sym}`;
  if (!d) return `${amount} ${sym}`;
  const s = amount.padStart(d + 1, "0");
  return `${s.slice(0, -d)}.${s.slice(-d).replace(/0+$/, "") || "0"} ${sym}`;
}
export function explainPnl(history: any[], balances: { token: string; balance: string }[]): string {
  const lines: string[] = [];
  let usdIn = 0;
  for (const e of history) {
    if (e.kind === "swap" || e.kind === "copy") {
      if (e.status === "success") usdIn += Number(e.usd_in_micro ?? 0);
      lines.push(`${new Date(e.ts_ms).toISOString()} ${e.kind}: ${fmt(e.token_in, e.amount_in)} -> ${fmt(e.token_out, e.amount_out)} [${e.status}]`);
    } else if (e.kind === "withdraw") lines.push(`${new Date(e.ts_ms).toISOString()} withdraw: ${fmt(e.token, e.amount)} to ${e.chain} [${e.status}]`);
  }
  const bal = balances.map((b) => fmt(b.token, b.balance)).join(", ") || "empty";
  return [`Trades: ${lines.length}. USD put into trades: $${(usdIn / 1e6).toFixed(2)}.`, `Confidential balance now: ${bal}.`, ...lines,
    "Note: values are from your private log inside the TEE; current USD value of balances needs a fresh quote."].join("\n");
}
