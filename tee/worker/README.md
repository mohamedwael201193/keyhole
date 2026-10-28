# KEYHOLE TEE worker

A WASI (wasm32-wasip2) program that runs inside an OutLayer Intel TDX enclave. Every reply carries an attestation whose `executed_wasm_sha256` is the hash of this build.

## Ops

| op | auth | what it does |
|---|---|---|
| `info` | none | version, keys contract, NEP-413 recipient, TEE minter account, limits per tier |
| `status` | NEP-413 | your tier, limits and today's spend |
| `quote` | NEP-413 + key | private (confidential) swap quote via NEAR Intents 1Click, checked against your caps first. `execute: true` returns a real deposit address and counts toward your daily cap |
| `mint` | NEP-413 | mints one Bronze key to your account (one per account, global daily quota). Metadata includes `media` (the key art URL on keyhole-seven.vercel.app) and `media_hash` (base64 sha256 of that file) |
| `account` | NEP-413 + key | your own confidential account (an OutLayer custody wallet created inside the TEE for you; its API key never leaves the enclave). Optional `{chain, token, amount}` returns a cross-chain deposit address |
| `balance` | NEP-413 + key | confidential balances |
| `swap` / `copy` | NEP-413 + key | confidential swap `{token_in, token_out, amount_in, min_amount_out?}` within caps, logged privately |
| `withdraw` | NEP-413 + key | `{chain, to, token, amount}` out of the confidential account, within caps. `to` must be the NEP-413 signer; any other account is `bad_params` and nothing is sent |
| `history` | NEP-413 + key | your private log (last 100) |
| `sweep_minter` | none | if this enclave is no longer the contract's minter, sends its NEAR to the current minter |

## How a request is checked (in order)

1. NEP-413 signature: `sha256(borsh(2147484061) ‖ borsh{message, nonce[32], recipient, callbackUrl?})`, ed25519 strict verify.
2. `recipient` must be `keyhole` (a signature made for another app is refused).
3. The signed message is JSON `{op, account_id, ts_ms, params}`; `op` and `account_id` must match the call. The worker only acts on signed fields.
4. The public key must be a full-access key of `account_id` (live RPC check).
5. `ts_ms` within 5 minutes of the latest final block time.
6. Key tier read from the keys contract (`holder_tier`).
7. Rate limits: per holder per minute (by tier) and global.
8. Replay: `(account, nonce)` stored with atomic `set_if_absent`. A second use is refused (`replay`).
9. Caps: the USD value comes from the solver quote, not from the caller. Per-trade and per-UTC-day caps per holder. Over-cap → `over_cap_per_tx` / `over_cap_daily`, and nothing is sent.

State is per holder (`h/<account>/…` in OutLayer encrypted storage; NEAR account ids cannot contain `/`).

## Default limits

| tier | per trade | per day | requests/min |
|---|---|---|---|
| 1 Bronze | $1 | $5 | 6 |
| 2 Silver | $10 | $50 | 12 |
| 3 Gold | $100 | $500 | 30 |

Global: 120 requests/min, 25 free mints/day.

## Minter key

On first use the worker draws 32 random bytes inside the enclave and keeps them in encrypted storage. Only the public key leaves the enclave. Its implicit account is set as the keys contract's `minter`, so new keys can only be minted by this attested code.

## Transactions

The minter signs NEAR transactions itself inside the enclave (borsh-encoded, tested byte-for-byte against near-api-js) and broadcasts with `send_tx`.

## Errors

Every failure is `{"ok": false, "error": {"code", "message"}}`. Codes: `no_auth, bad_account, wrong_recipient, bad_public_key, bad_nonce, bad_signature, bad_message, account_mismatch, op_mismatch, key_not_owned, expired, no_key, rate_limited, busy, replay, over_cap_per_tx, over_cap_daily, bad_params, upstream, config, already_holder, mint_quota, mint_failed, tx_failed, policy_denied, still_minter, empty, unknown_op`.

## Build and test

```
cargo test        # unit tests: NEP-413, replay, caps, rate limits, tx encoding
./build.sh        # reproducible build (pinned toolchain, path remapping); prints the sha256. DEPLOYED_SHA256 is the published enclave, which this source no longer matches
```

Config (OutLayer project env/secrets): `KEYS_CONTRACT` (default `keyhole-devmo.near`), `NEP413_RECIPIENT` (default `keyhole`), `ONECLICK_JWT` (secret).
