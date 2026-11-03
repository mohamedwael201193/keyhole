/**
 * NEAR wallets connect through @hot-labs/near-connect, the connector NEAR's docs use for wallet login:
 * https://docs.near.org/web3-apps/tutorials/wallet-login
 * `connect({ signMessageParams })` signs in AND signs one NEP-413 message in the same wallet prompt
 * (https://github.com/hot-dao/near-selector, README "Initialize connection to wallet and sign in").
 * We make that message the enclave's `session` request (docs.near.org/web3-apps/backend/backend pattern),
 * so connect + unlock is one popup. The account is not known yet, so account_id is "" — allowed for op
 * `session` only; the enclave uses the NEP-413 signer and checks it is a full-access key of that account.
 */
import { NEP413_RECIPIENT } from "./config";
import { freshNonce, toB64, type SignedAuth } from "./nep413";
import { SESSION_CAP_USD_MICRO, SESSION_TTL_MS } from "./session";

export const NC_WALLET_KEY = "selected-wallet";

export function signInRequest(now = Date.now(), nonce: Uint8Array = freshNonce()) {
  const message = JSON.stringify({ op: "session", account_id: "", ts_ms: now, params: { ttl_ms: SESSION_TTL_MS, max_usd_micro: SESSION_CAP_USD_MICRO } });
  return { message, recipient: NEP413_RECIPIENT, nonce };
}

/** Turn near-connect's signedMessage into the worker's NEP-413 auth. */
export function authFromSignIn(req: { message: string; recipient: string; nonce: Uint8Array }, signed: { accountId: string; publicKey: string; signature: string }): SignedAuth {
  return { account_id: signed.accountId, public_key: signed.publicKey, signature: signed.signature, nonce: toB64(req.nonce), message: req.message, recipient: req.recipient };
}

/** A sign-in signature can be reused (once) within the enclave's 5-minute freshness window, e.g. right after minting. */
export const SIGNIN_REUSE_MS = 4 * 60 * 1000;
export const reusable = (message: string, now = Date.now()) => {
  try { const ts = (JSON.parse(message) as { ts_ms?: number }).ts_ms ?? 0; return now - ts < SIGNIN_REUSE_MS; } catch { return false; }
};
