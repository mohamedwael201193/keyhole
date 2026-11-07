# Key transfer on build a985fd87 (team test wallets)

A sale of one KEYHOLE key, run on the current build, 2026-11-07 19:03 to 19:04 UTC. Both wallets are **team test wallets**, not independent users. The run shows the transfer rules on the live build. It does not show user adoption.

- Token: `k5f4750858f328940` (KEYHOLE Key · Bronze) on [`keyhole-devmo.near`](https://nearblocks.io/address/keyhole-devmo.near).
- Seller A (team test wallet, first owner): `3bde8ce5eb4e15403d49ba9512a98070db68958b39f378816f7862cee6168447`
- Buyer B (team test wallet, new owner): `0705fdc1581a35351453bd4625f22d0c41b2b9edc3e7bed860586623c6778228`
- Owner after the sale, read with `nft_token` at finality `final` (fastnear RPC): `0705fdc1…8228` = B.
- Build: `a985fd87866c4a586603d30f0f73bdff1506e381c5b8a748973302d028b9e4f8`. Every attestation below has `executed_wasm_sha256` equal to this build.

## Steps

"Expected" is what the rules predict. "Actual" is the outcome recorded in the run. The attestation API returns the build, the time and an `output_hash`, but not the output body, so the actual outcome of each call is taken from the run log. The attestation files below confirm the build, the time and the output hash. Steps 1 and 5 have an attestation read but no saved file.

| Step | Call | Action | Expected | Actual | Attested (UTC) | Evidence |
|---|---|---|---|---|---|---|
| 1 | `baccd727-cdca-4b3e-ae93-999fd581444a` | A status, before the sale | ok, A holds the key | ok | 19:03:37, attestation 1306933 | attestation read, not saved |
| 1b | [`ece5d109-6b98-442f-b682-96af0a23f2e7`](https://api.outlayer.ai/attestations/by-call/ece5d109-6b98-442f-b682-96af0a23f2e7) | A balance, before the sale | ok, 2000 USDC base units | ok, 2000 USDC base units | 19:03:43, attestation 1306934 | [attestation_ece5d109.json](attestation_ece5d109.json) |
| 2 | tx [`89vSYY4t…`](https://nearblocks.io/txns/89vSYY4tbeNPuNuhHB8YmkkAWAcjW5VdniQm3ePHuPYz) | `nft_transfer` of `k5f47508…` from A to B | SuccessValue | SuccessValue | 19:04:05 (block) | nearblocks: status true |
| 3 | [`2a52742a-2b4a-432d-b087-888ea52f03ce`](https://api.outlayer.ai/attestations/by-call/2a52742a-2b4a-432d-b087-888ea52f03ce) | A balance, after the sale | refused `not_owner` | refused `not_owner` | 19:04:20, attestation 1306940 | [attestation_2a52742a.json](attestation_2a52742a.json) |
| 4 | [`3e996273-e4a0-4c26-aa54-6775fba29236`](https://api.outlayer.ai/attestations/by-call/3e996273-e4a0-4c26-aa54-6775fba29236) | B balance, after the sale | ok, the same 2000 USDC base units (the account moved with the token) | ok, 2000 USDC base units | 19:04:23, attestation 1306942 | [attestation_3e996273.json](attestation_3e996273.json) |
| 5 | `15f93f58-2568-4064-9581-db04c8b2a1aa` | A replays its saved step-1 signed request | refused `not_owner` (the owner check runs before the nonce check) | refused `not_owner` | 19:04:28, attestation 1306944 | attestation read, not saved |
| 6 | [`8485f8d4-c4e1-4ab5-ab9c-a19a0d9d21f7`](https://api.outlayer.ai/attestations/by-call/8485f8d4-c4e1-4ab5-ab9c-a19a0d9d21f7) | B withdraws right after the transfer | refused `cooldown` (10 minutes after a transfer) | refused `cooldown` | 19:04:30, attestation 1306945 | [attestation_8485f8d4.json](attestation_8485f8d4.json) |
| 7 | no enclave call: site gateway, session-scheme withdraw | withdraw with a session token | HTTP 403 `session_scope`, refused before any enclave call | HTTP 403 `session_scope` | not attested | gateway response only |

Attestations for steps 1b, 3, 4 and 6 have `executed_wasm_sha256` and `wasm_hash` equal to `a985fd87…e4f8`, a TDX quote present and a timestamp inside the run. Their `output_hash` values are: step 1b `06cee96d…`, step 3 `60db56c1…`, step 4 `83715d18…`, step 6 `e8c16921…`.

## What this shows

- The old owner loses access at the next call, including a signed request sent before the sale (steps 3 and 5).
- The new owner gets the same account with the same balance (step 4).
- The new owner cannot withdraw straight after the transfer (step 6).
- A session token cannot withdraw at the gateway (step 7). This is a gateway refusal, not an attested enclave answer.

## What this does not show

- Real users, real trades or real value. Both wallets are team test wallets, and the amounts are test amounts.
- The output bodies. They are not in the attestation API and are not published here.
- Steps 1, 5 and 7 have no saved attestation file in this folder.
