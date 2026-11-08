// Balance proof for one key, as the enclave signs it (the `prove` op), checked in the browser.
// The signature check is the one /pnl uses (sigValid in lib/pnl.ts). The signer must be the minter the contract names.
import { sigValid } from "./pnl";

export const PROOF_KIND = "keyhole-balance-proof-v1";
/** A share link stays well under a browser's URL limit; anything longer is not a proof this app made. */
export const MAX_PROOF_CHARS = 8192;

/** What a share link carries: the exact signed bytes, the signature, the signer and the attested call. */
export interface KeyProofShare { statement: string; sig: string; minter: string; call_id: string | null }

/** The fields the enclave signs (proof_canonical in tee/worker/src/lib.rs). The statement names a yes/no, never a balance. */
export interface KeyProofStatement {
  kind: typeof PROOF_KIND;
  token_id: string;
  owner: string;
  asset: string;
  min: string;
  holds_at_least: boolean;
  locked_until_ms: number;
  log_head: string;
  ts_ms: number;
}

const toB64url = (text: string) => {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (s: string): string | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(s) || s.length % 4 === 1) return null;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

/** base64url of the JSON share object, key order fixed. */
export function encodeKeyProof(p: KeyProofShare): string {
  return toB64url(JSON.stringify({ statement: p.statement, sig: p.sig, minter: p.minter, call_id: p.call_id }));
}

/** Null for anything that is not a readable share object. Never throws. */
export function decodeKeyProof(raw: string): KeyProofShare | null {
  if (!raw || raw.length > MAX_PROOF_CHARS) return null;
  try {
    const text = fromB64url(raw);
    if (text === null) return null;
    const j = JSON.parse(text) as Partial<KeyProofShare> | null;
    if (!j || typeof j !== "object") return null;
    if (typeof j.statement !== "string" || typeof j.sig !== "string" || typeof j.minter !== "string") return null;
    if (j.call_id != null && typeof j.call_id !== "string") return null;
    return { statement: j.statement, sig: j.sig, minter: j.minter, call_id: j.call_id ?? null };
  } catch { return null; }
}

/** The balance-proof statement, or null when the bytes are not one. */
export function parseKeyStatement(s: string): KeyProofStatement | null {
  try {
    const o = JSON.parse(s) as Record<string, unknown> | null;
    if (!o || typeof o !== "object") return null;
    const ok = o.kind === PROOF_KIND
      && typeof o.token_id === "string" && typeof o.owner === "string" && typeof o.asset === "string"
      && typeof o.min === "string" && /^\d+$/.test(o.min)
      && typeof o.holds_at_least === "boolean"
      && Number.isSafeInteger(o.locked_until_ms) && Number.isSafeInteger(o.ts_ms)
      && typeof o.log_head === "string";
    return ok ? (o as unknown as KeyProofStatement) : null;
  } catch { return null; }
}

export type CheckId = "decoded" | "statement" | "signature" | "minter" | "token" | "owner";
/** pass: true or false from a real check; null when the check could not run yet (or at all). */
export interface ProofCheck { id: CheckId; pass: boolean | null; label: string; detail: string }
export type ProofVerdict = "pass" | "fail" | "pending" | "unverified";
export interface ProofReport { verdict: ProofVerdict; checks: ProofCheck[]; statement: KeyProofStatement | null }

export interface ProofContext {
  /** The key id on the page the proof is opened on. */
  tokenId: string;
  /** The holder read from the chain now. undefined while reading, null when unavailable. */
  chainOwner: string | null | undefined;
  /** The minter the contract names. undefined while reading, null when unavailable. */
  contractMinter: string | null | undefined;
}

/**
 * Every check a buyer needs, in order. PASS only when each one is a real true: the signature is checked over the exact
 * statement bytes, the signer is the contract's minter, the token is this key, and the owner is the holder on chain now.
 */
export function verifyKeyProof(raw: string, ctx: ProofContext): ProofReport {
  const share = decodeKeyProof(raw);
  if (!share) {
    const notChecked = "Not checked: the link has no readable proof.";
    return {
      verdict: "fail",
      statement: null,
      checks: [
        { id: "decoded", pass: false, label: "Readable proof", detail: "This link does not carry a readable proof." },
        { id: "statement", pass: null, label: "Statement is a balance proof", detail: notChecked },
        { id: "signature", pass: null, label: "Signature valid", detail: notChecked },
        { id: "minter", pass: null, label: "Signer is the contract's minter", detail: notChecked },
        { id: "token", pass: null, label: "Proof is for this key", detail: notChecked },
        { id: "owner", pass: null, label: "Holder read from chain", detail: notChecked },
      ],
    };
  }

  const st = parseKeyStatement(share.statement);
  const sigOk = sigValid(share);
  const reading = ctx.chainOwner === undefined || ctx.contractMinter === undefined;

  const minterPass = ctx.contractMinter == null ? null : share.minter.toLowerCase() === ctx.contractMinter.toLowerCase();
  const minterDetail = ctx.contractMinter === undefined ? "Reading the minter the contract names."
    : ctx.contractMinter === null ? "Could not read the minter the contract names, so the signer is not checked."
    : minterPass ? "The proof is signed by the minter the NEAR contract names."
    : "The proof is signed by a different key than the contract's minter.";

  const tokenPass = st ? st.token_id === ctx.tokenId && ctx.tokenId !== "" : null;
  const tokenDetail = !st ? "Not checked: the statement is not a balance proof."
    : tokenPass ? `The proof names key ${st.token_id}.`
    : `This proof is for key ${st.token_id}, not ${ctx.tokenId || "this page"}.`;

  let ownerPass: boolean | null = null;
  let ownerLabel = "Holder read from chain";
  let ownerDetail = "Not checked: the statement is not a balance proof.";
  if (st && ctx.chainOwner === undefined) ownerDetail = "Reading the holder from the NEAR chain.";
  else if (st && ctx.chainOwner === null) ownerDetail = "Could not read the holder from the NEAR chain, so the owner is not checked.";
  else if (st && typeof ctx.chainOwner === "string") {
    ownerPass = st.owner === ctx.chainOwner;
    ownerLabel = ownerPass ? "Holder is still the owner" : "Owner changed since this proof";
    ownerDetail = ownerPass ? `${st.owner} holds the key on chain now.`
      : `The proof names ${st.owner}. The key is held by ${ctx.chainOwner} now, so this proof is for a previous owner.`;
  }

  const checks: ProofCheck[] = [
    { id: "decoded", pass: true, label: "Readable proof", detail: "The link decodes to a signed statement." },
    { id: "statement", pass: st !== null, label: "Statement is a balance proof", detail: st ? "All fields of a keyhole-balance-proof-v1 statement are present." : "The signed bytes are not a balance proof statement." },
    { id: "signature", pass: sigOk, label: "Signature valid", detail: sigOk ? "ed25519 over the exact statement bytes, checked in your browser." : "The signature does not match the statement bytes and the signer in the link." },
    { id: "minter", pass: minterPass, label: "Signer is the contract's minter", detail: minterDetail },
    { id: "token", pass: tokenPass, label: "Proof is for this key", detail: tokenDetail },
    { id: "owner", pass: ownerPass, label: ownerLabel, detail: ownerDetail },
  ];
  const failed = checks.some((c) => c.pass === false);
  const allTrue = checks.every((c) => c.pass === true);
  const verdict: ProofVerdict = failed ? "fail" : allTrue ? "pass" : reading ? "pending" : "unverified";
  return { verdict, checks, statement: st };
}

/** Plain age of a signed time, for the proof panel. Future times (clock skew) read as "just now". */
export function ageLabel(tsMs: number, nowMs: number): string {
  const s = Math.floor((nowMs - tsMs) / 1000);
  if (!Number.isFinite(s) || s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 172_800) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} days ago`;
}
