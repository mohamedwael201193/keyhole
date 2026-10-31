/** Every worker error.code mapped to a short message key + fix key (see messages/*.json "errors"). */
export const WORKER_ERROR_CODES = [
  "account_mismatch", "already_holder", "already_minted", "bad_account", "bad_message", "bad_nonce", "bad_params",
  "bad_public_key", "bad_signature", "bad_log", "config", "expired", "key_not_owned", "mint_failed", "minter_low_balance", "no_auth", "locked", "no_key", "not_owner",
  "op_mismatch", "over_cap_daily", "wrong_recipient", "empty", "policy_denied", "signer", "still_minter", "tx_failed", "over_cap_per_tx", "replay", "rng", "rpc", "storage", "unknown_op", "upstream",
  // gateway-side codes
  "rate_limited", "service_unfunded", "too_large", "bad_op", "gateway", "wallet_no_sign_message", "wallet_rejected", "metamask_next_enclave", "network",
] as const;
export type ErrorCode = (typeof WORKER_ERROR_CODES)[number];
export const isKnownCode = (c: string): c is ErrorCode => (WORKER_ERROR_CODES as readonly string[]).includes(c);
