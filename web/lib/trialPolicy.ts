import { createHash } from "node:crypto";
import bs58 from "bs58";
import { GUEST_DEPOSIT_YOCTO, TRIAL_SPONSOR } from "./trialPublic";

export { GUEST_DEPOSIT_YOCTO };
/** Attached to nft_mint. The contract refunds the excess over storage. */
export const MINT_DEPOSIT_YOCTO = "100000000000000000000000";
export const MINT_GAS = "80000000000000";
export const CREATE_GAS = "60000000000000";
/** Practice keys are Bronze, the same tier a new mainnet key starts at. */
export const PRACTICE_TIER = 1;

const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function isNearAccount(id: string): boolean {
  return id.length >= 2 && id.length <= 64 && ACCOUNT_RE.test(id);
}

/** A browser-generated ed25519 public key. The matching secret never reaches this module. */
export function isEd25519PublicKey(value: string): boolean {
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(value)) return false;
  try { return bs58.decode(value.slice("ed25519:".length)).length === 32; }
  catch { return false; }
}

/** 12 hex chars from the server, so the name cannot be chosen by the caller. */
export function guestAccountId(hex: string): string | null {
  if (!/^[a-f0-9]{12}$/.test(hex)) return null;
  const id = `kh${hex}.testnet`;
  return isNearAccount(id) ? id : null;
}

export function isTrialReceiver(id: string): boolean {
  return isNearAccount(id) && id.endsWith(".testnet") && !id.endsWith(".near");
}

export type Sponsor = { accountId: string; secret: string };

/**
 * The sponsor is a separate testnet account. It is not the keys contract.
 * A missing secret, a mainnet id, or any account other than the recorded sponsor is refused here.
 * trialSend still requires config.minter on chain to equal this account before it signs.
 */
export function readSponsor(env: Record<string, string | undefined>): Sponsor | null {
  const accountId = env.KEYHOLE_TESTNET_SPONSOR_ACCOUNT?.trim() ?? "";
  const secret = env.KEYHOLE_TESTNET_SPONSOR_SECRET?.trim() ?? "";
  if (accountId !== TRIAL_SPONSOR || !isTrialReceiver(accountId)) return null;
  if (!secret.startsWith("ed25519:") || secret.length < 48) return null;
  return { accountId, secret };
}

export function scrubSecret(text: string, secret: string): string {
  if (!secret) return text.slice(0, 300);
  return text.split(secret).join("[redacted]").slice(0, 300);
}

/**
 * Shared ceilings, recomputed for a 0.05 NEAR guest deposit.
 * A guest keeps 0.05 NEAR. Create and mint gas, plus the mint storage that is not refunded, are about 0.03 NEAR more.
 * About 8.67 testnet NEAR on the sponsor fits 80 guests with headroom. The nonce ceiling counts every signed transaction from SPONSOR_NONCE_BASE.
 * Per-address limits need UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN. Without both, the site-wide on-chain ceiling applies.
 */
export const GUEST_PER_IP_HOUR = 8;
export const GLOBAL_PER_HOUR = 40;
export const GLOBAL_PER_DAY = 200;
export const LIFETIME_GUESTS = 80;
export const LIFETIME_TX = LIFETIME_GUESTS * 2;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const TRIAL_HOUR_MS = HOUR_MS;
export const TRIAL_DAY_MS = DAY_MS;
/** Keep a create, a mint, and gas after this guest. Below this, create_account is refused. */
export const MIN_LIQUID_YOCTO = BigInt(GUEST_DEPOSIT_YOCTO) + BigInt(MINT_DEPOSIT_YOCTO) + 200_000_000_000_000_000_000_000n;

const IDEM = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The same key always names the same guest, so a retry cannot fund a second account. */
export function accountIdForIdempotency(key: string): string | null {
  if (!IDEM.test(key)) return null;
  return guestAccountId(createHash("sha256").update(key.toLowerCase()).digest("hex").slice(0, 12));
}

export function tokenIdForIdempotency(key: string): string | null {
  if (!IDEM.test(key)) return null;
  const hex = createHash("sha256").update(`mint:${key.toLowerCase()}`).digest("hex").slice(0, 16);
  return practiceTokenId(hex);
}

export function practiceTokenId(hex: string): string | null {
  if (!/^[a-f0-9]{16}$/.test(hex)) return null;
  return `k${hex}`;
}
