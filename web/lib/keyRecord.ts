// The signed record of a listed key (the `record` op), checked in the browser. The enclave signs the statement with the same
// minter key as the balance proof (lib/keyProof.ts); the signature check is the one /pnl uses (sigValid in lib/pnl.ts).
import { sigValid, type PnlShare } from "./pnl";

export const RECORD_KIND = "keyhole-record-v1";
/** A record signed longer ago than this is not shown as current. The listing card reads a fresh one each time. */
export const RECORD_MAX_AGE_MS = 24 * 3_600_000;
/** A statement stamped further ahead of this device's clock than this cannot be from the enclave's clock. */
export const RECORD_MAX_SKEW_MS = 5 * 60_000;

/** The fields the enclave signs for a listed key. Money is micro-USD; price is yoctoNEAR; times are epoch milliseconds. */
export interface KeyRecordStatement {
  kind: typeof RECORD_KIND;
  token_id: string;
  owner: string;
  tier: number;
  price: string;
  seller: string;
  settled_swaps: number;
  volume_usd_micro: number;
  trades: number;
  /** USD paid in across the holder's trades (micro-USD), priced at trade time. */
  cost: number;
  /** Output per token, in base units. The browser shows no amounts from it. */
  outs: Record<string, string | number>;
  /** First trade time, or 0 when the holder has traded nothing. */
  since: number;
  log_head: string;
  ts_ms: number;
}

/** What the listing card gets back from the enclave: the exact signed bytes, the signature and the signer. */
export interface KeyRecordShare { statement: string; sig: string; minter: string; call_id: string | null }

export type RecordCheckId = "statement" | "signature" | "minter" | "token" | "owner" | "seller" | "age";
export interface RecordCheck { id: RecordCheckId; pass: boolean | null; label: string; detail: string }
export type RecordVerdict = "pass" | "fail" | "pending" | "unverified";
export interface RecordReport { verdict: RecordVerdict; checks: RecordCheck[]; statement: KeyRecordStatement | null }

/** The listing and chain facts the record is checked against. undefined while a read is in flight, null when it failed. */
export interface RecordContext {
  /** The key id on the page. */
  tokenId: string;
  /** The holder read from the chain now. */
  chainOwner: string | null | undefined;
  /** The seller of the listing on the page. */
  listedSeller: string;
  /** The minter the contract names. */
  contractMinter: string | null | undefined;
  /** This device's clock, epoch milliseconds. */
  nowMs: number;
}

const safeInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** The record statement, or null when the bytes are not one. Never throws. */
export function parseRecordStatement(s: string): KeyRecordStatement | null {
  try {
    const o = JSON.parse(s) as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const outs = o.outs;
    const ok = o.kind === RECORD_KIND
      && typeof o.token_id === "string" && typeof o.owner === "string" && typeof o.seller === "string"
      && typeof o.log_head === "string"
      && typeof o.price === "string" && /^\d+$/.test(o.price)
      && safeInt(o.tier) && safeInt(o.settled_swaps) && safeInt(o.volume_usd_micro)
      && safeInt(o.trades) && safeInt(o.cost) && safeInt(o.since) && safeInt(o.ts_ms)
      && typeof outs === "object" && outs !== null && !Array.isArray(outs);
    return ok ? (o as unknown as KeyRecordStatement) : null;
  } catch { return null; }
}

/**
 * Every check a buyer needs for a listed key, in order. PASS only when each one is a real true. The signature is checked over
 * the exact statement bytes; the signer must be the contract's minter, the key the page's key, the holder the chain's holder
 * and the seller the listing's seller.
 */
export function verifyKeyRecord(share: KeyRecordShare, ctx: RecordContext): RecordReport {
  const st = parseRecordStatement(share.statement);
  const pnl: PnlShare = { statement: share.statement, sig: share.sig, minter: share.minter, call_id: share.call_id };
  const sigOk = sigValid(pnl);
  const notRun = "Not checked: the statement is not a listed-key record.";
  const reading = ctx.chainOwner === undefined || ctx.contractMinter === undefined;

  const minterPass = ctx.contractMinter == null ? null : share.minter.toLowerCase() === ctx.contractMinter.toLowerCase();
  const minterDetail = ctx.contractMinter === undefined ? "Reading the minter the contract names."
    : ctx.contractMinter === null ? "Could not read the minter the contract names, so the signer is not checked."
    : minterPass ? "The record is signed by the minter the NEAR contract names."
    : "The record is signed by a different key than the contract's minter.";

  const tokenPass = st ? st.token_id === ctx.tokenId && ctx.tokenId !== "" : null;
  const tokenDetail = !st ? notRun
    : tokenPass ? `The record is for key ${st.token_id}.`
    : `This record is for key ${st.token_id}, not ${ctx.tokenId || "this page"}.`;

  let ownerPass: boolean | null = null;
  let ownerDetail = notRun;
  if (st && ctx.chainOwner === undefined) ownerDetail = "Reading the holder from the NEAR chain.";
  else if (st && ctx.chainOwner === null) ownerDetail = "Could not read the holder from the NEAR chain, so the owner is not checked.";
  else if (st && typeof ctx.chainOwner === "string") {
    ownerPass = st.owner === ctx.chainOwner;
    ownerDetail = ownerPass ? `${st.owner} holds the key on chain now.`
      : `The record names ${st.owner}. The key is held by ${ctx.chainOwner} now, so this record is out of date.`;
  }

  const sellerPass = st ? st.seller === ctx.listedSeller : null;
  const sellerDetail = !st ? notRun
    : sellerPass ? `${st.seller} is the seller on this listing.`
    : `The record names ${st.seller} as seller, but this listing is by ${ctx.listedSeller}.`;

  let agePass: boolean | null = null;
  let ageDetail = notRun;
  if (st) {
    const ahead = st.ts_ms - ctx.nowMs;
    const old = ctx.nowMs - st.ts_ms;
    agePass = ahead <= RECORD_MAX_SKEW_MS && old <= RECORD_MAX_AGE_MS;
    ageDetail = ahead > RECORD_MAX_SKEW_MS ? "The record is stamped in the future, so the clocks do not agree."
      : agePass ? "Signed within the last day."
      : "The record is more than a day old. Reload the listing for a fresh one.";
  }

  const checks: RecordCheck[] = [
    { id: "statement", pass: st !== null, label: "Statement is a listed-key record", detail: st ? "All fields of a keyhole-record-v1 statement are present." : "The signed bytes are not a listed-key record statement." },
    { id: "signature", pass: sigOk, label: "Signature valid", detail: sigOk ? "ed25519 over the exact statement bytes, checked in your browser." : "The signature does not match the statement bytes and the signer in the record." },
    { id: "minter", pass: minterPass, label: "Signer is the contract's minter", detail: minterDetail },
    { id: "token", pass: tokenPass, label: "Record is for this key", detail: tokenDetail },
    { id: "owner", pass: ownerPass, label: ownerPass === false ? "Owner changed since this record" : "Holder is the owner on chain now", detail: ownerDetail },
    { id: "seller", pass: sellerPass, label: "Seller is the listing seller", detail: sellerDetail },
    { id: "age", pass: agePass, label: "Signed recently", detail: ageDetail },
  ];
  const failed = checks.some((c) => c.pass === false);
  const allTrue = checks.every((c) => c.pass === true);
  const verdict: RecordVerdict = failed ? "fail" : allTrue ? "pass" : reading ? "pending" : "unverified";
  return { verdict, checks, statement: st };
}

export type RecordFetch =
  | { kind: "ok"; share: KeyRecordShare }
  /** The worker does not run the op yet. Shown as "opens with the next enclave release", never with numbers. */
  | { kind: "unavailable" }
  | { kind: "error"; code: string };

/** Asks the gateway for the signed record of a key. No wallet: the record is public for a listed key. Never throws. */
export async function fetchKeyRecord(tokenId: string, fetchFn: typeof fetch = fetch): Promise<RecordFetch> {
  let j: { call_id?: string | null; output?: Record<string, unknown> | null; error?: { code?: unknown } } | null;
  try {
    const r = await fetchFn("/api/worker", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "record", token_id: tokenId }) });
    j = await r.json().catch(() => null);
  } catch { return { kind: "error", code: "network" }; }
  if (!j || typeof j !== "object") return { kind: "error", code: "gateway" };
  if (j.error) return { kind: "error", code: typeof j.error.code === "string" ? j.error.code : "gateway" };
  const out = j.output ?? null;
  if (out && out.ok === true && typeof out.statement === "string" && typeof out.sig === "string" && typeof out.minter === "string") {
    return { kind: "ok", share: { statement: out.statement, sig: out.sig, minter: out.minter, call_id: j.call_id ?? null } };
  }
  const err = out?.error as { code?: unknown } | undefined;
  const code = typeof err?.code === "string" ? err.code : "gateway";
  return code === "unknown_op" ? { kind: "unavailable" } : { kind: "error", code };
}
