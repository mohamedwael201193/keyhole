// Signed counterparty reports. An agent that sees a bad receiver signs a report with a full-access key of its own account
// (NEP-413, recipient "keyhole-blocklist") and sends the JSON to a curator. The curator runs verifyReport, checks on chain that
// public_key is a full-access key of `reporter`, and only then adds the entry to security/blocklist.json by pull request.
// verifyReport proves the report was signed by the key it names. It does not prove the key belongs to the reporter: that check is on chain.
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes } from "@noble/hashes/utils";
import bs58 from "bs58";
import { nep413Bytes, type Key } from "./core.js";
import { isNearAccountId } from "./counterparty.js";

export const REPORT_RECIPIENT = "keyhole-blocklist";
export const REPORT_KIND = "keyhole.counterparty-report.v1";
export const REPORT_MAX_AGE_MS = 24 * 3_600_000;

export interface CounterpartyReport {
  kind: typeof REPORT_KIND;
  reporter: string;
  account: string;
  reason: string;
  /** NEAR transaction hash (base58, 43 or 44 characters) that shows the harm. */
  evidence_tx: string;
  ts_ms: number;
}
export interface SignedReport { account_id: string; public_key: string; signature: string; nonce: string; message: string; recipient: string }

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

export function signReport(key: Key, r: { account: string; reason: string; evidence_tx: string }, now = Date.now(), nonce: Uint8Array = randomBytes(32)): SignedReport {
  const report: CounterpartyReport = { kind: REPORT_KIND, reporter: key.accountId, account: r.account, reason: r.reason, evidence_tx: r.evidence_tx, ts_ms: now };
  const message = JSON.stringify(report);
  const sig = ed25519.sign(sha256(nep413Bytes(message, nonce, REPORT_RECIPIENT)), key.secret);
  return { account_id: key.accountId, public_key: key.publicKey, signature: b64(sig), nonce: b64(nonce), message, recipient: REPORT_RECIPIENT };
}

export function verifyReport(s: SignedReport, now = Date.now()): { ok: true; report: CounterpartyReport } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (s.recipient !== REPORT_RECIPIENT) return fail("wrong recipient");
  if (typeof s.public_key !== "string" || !s.public_key.startsWith("ed25519:")) return fail("public_key must be ed25519");
  let pk: Uint8Array, sig: Uint8Array, nonce: Uint8Array;
  try {
    pk = bs58.decode(s.public_key.slice(8));
    sig = fromB64(s.signature);
    nonce = fromB64(s.nonce);
  } catch { return fail("malformed key, signature or nonce"); }
  if (pk.length !== 32 || sig.length !== 64 || nonce.length !== 32) return fail("wrong key, signature or nonce length");
  let r: CounterpartyReport;
  try { r = JSON.parse(s.message) as CounterpartyReport; } catch { return fail("message is not JSON"); }
  if (r.kind !== REPORT_KIND) return fail("unknown report kind");
  if (r.reporter !== s.account_id) return fail("reporter must be the signing account");
  if (!isNearAccountId(r.account)) return fail("account is not a NEAR account id");
  if (typeof r.reason !== "string" || r.reason.length < 1 || r.reason.length > 280) return fail("reason must be 1 to 280 characters");
  if (typeof r.evidence_tx !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(r.evidence_tx)) return fail("evidence_tx must be a NEAR transaction hash");
  if (typeof r.ts_ms !== "number" || r.ts_ms > now + 300_000 || now - r.ts_ms > REPORT_MAX_AGE_MS) return fail("report is stale or from the future");
  let good = false;
  try { good = ed25519.verify(sig, sha256(nep413Bytes(s.message, nonce, s.recipient)), pk); } catch { good = false; }
  return good ? { ok: true, report: r } : fail("bad signature");
}
