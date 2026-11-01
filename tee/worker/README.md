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
| `history` | NEP-413 or EIP-191 + key | private activity log, plus the full per-key provenance rows for the holder |
| `provenance` | none | public owner chain and event hashes for `token_id`. No amounts. |
| `lock` | NEP-413 or EIP-191 + key | `{hours: 1..168}` refuse swap and withdraw until then; cannot be lifted early; a transfer ends it |
| `prove` | NEP-413 or EIP-191 + key | `{token, min}` minter-signed statement that the key's account holds at least `min`; `node verify-log.mjs --proof` checks it |
| `sweep_minter` | none | if this enclave is no longer the contract's minter, sends its NEAR to the current minter |

## How a request is checked (in order)

1. NEP-413 signature: `sha256(borsh(2147484061) ‖ borsh{message, nonce[32], recipient, callbackUrl?})`, ed25519 strict verify. Or `scheme: "eip191"`: recover `personal_sign` and require the address to equal the lowercase `0x` account id. Replay, caps and rate limits are the same either way. The published enclave does both.
2. `recipient` must be `keyhole` (a signature made for another app is refused).
3. The signed message is JSON `{op, account_id, ts_ms, params}`; `op` and `account_id` must match the call. The worker only acts on signed fields.
4. The public key must be a full-access key of `account_id` (live RPC check).
5. `ts_ms` within 5 minutes of the latest final block time.
6. Key tier from `holder_tier`, then `nft_tokens_for_owner` plus `nft_token.owner_id`. A keyed op whose signer is not that owner is `not_owner`. This is checked again immediately before a swap or withdraw is sent. If the key moved, the send is aborted and the funds stay in the custody account.
7. Rate limits: per holder per minute (by tier) and global.
8. Replay: `(account, nonce)` stored with atomic `set_if_absent`. A second use is refused (`replay`). Ownership is checked before the nonce is consumed, so a previous holder's unused signature is `not_owner`.
9. Caps: the USD value comes from the solver quote, not from the caller. Per-trade and per-UTC-day caps per holder. Over-cap → `over_cap_per_tx` / `over_cap_daily`, and nothing is sent.

`nft_mint` is attached with 20 Tgas (`MINT_GAS`). The minter balance is read first. If it cannot cover the deposit plus a fee buffer, the call is `minter_low_balance` and the mint quota is not spent.

The per-key log is hash-chained. `provenance` (no user signature) returns owner, kind, and event hashes. `history` returns the same chain plus the private detail to the current holder. `node verify-log.mjs log.json` recomputes the chain and checks the minter's ed25519 signature. `node verify-log.mjs --self-test` checks the script.

`./verify.sh <call_id>` prints `executed` (wasm sha256), `measurement` (the TDX measurement; a different value), and `deployed` (`DEPLOYED_SHA256`). `--rebuild` also requires the local `build.sh` hash to equal `executed`.

Custody wallet, trade log, lock and daily spend are per key (`t/<token_id>/…` and caps under `tok:<token_id>`); nonces and rate limits are per signer (`h/<account>/…`). NEAR account ids cannot contain `/` or `:`. A wallet an older build kept under `h/<account>/wallet` moves to that account's key once, on its first call.

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
./build.sh        # reproducible build (pinned toolchain, path remapping); prints the sha256 in DEPLOYED_SHA256 (6367401a)
```

Config (OutLayer project env/secrets): `KEYS_CONTRACT` (default `keyhole-devmo.near`), `NEP413_RECIPIENT` (default `keyhole`), `ONECLICK_JWT` (secret).
