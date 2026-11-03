# Spending policy

The tier caps are a policy inside the TEE worker. They are not a second contract. `limits_for_tier` in [`tee/worker/src/lib.rs`](../tee/worker/src/lib.rs) returns the numbers, and `enforce_caps` refuses the call before a swap or a withdraw is sent. On both ops the enclave also checks the NEP-413 signature, the nonce and the per-minute rate limit. The website's withdraw form sets the destination to the connected account.

| On-chain tier | Per trade | Per UTC day | Calls / minute |
|---|---|---|---|
| 1 Bronze | $1 | $5 | 6 |
| 2 Silver | $10 | $50 | 12 |
| 3 Gold | $100 | $500 | 30 |

Amounts are USD micro-units (`1_000_000` = $1). The USD figure comes from the solver quote, not from the caller. A refusal does not add to the daily counter. The next UTC day starts a new counter. Legendary on the site is a finish on a tier-3 key. It uses the Gold row.

## Local proof

`cargo test --locked --manifest-path tee/worker/Cargo.toml policy_table_refuses_over_cap_locally`

That test builds each row and asks `enforce_caps` for one micro-dollar over the per-trade cap. The error code is `over_cap_per_tx` and the stored spend stays `0`. The same function is what `swap` calls.

Related tests in the same file: `over_cap_daily_refused_and_rolled_back`, `rate_limit_per_holder`.

## Live proof

The published enclave is `09d481a5c3340856f0fe75d6ba89012887de5c1230c46bc1ef380d69d172aaf4` (705,474 bytes), [add_version](https://nearblocks.io/txns/F1XzcCczrnkGryZ4UuvmGQA1gFeW6U26KJEu9mne6ZQu). Previous: `f7217ae291c7c39c3df699f33a0f84a262c37388f992fa62652d941a01a85381` (699,469 bytes); `452df1fd4f69fac618da0a5c11f9b8b5a9f7b0c1c95d5785850dd4746c5c134d` (681,219 bytes). FastFS upload [`AUyw7Kjq…`](https://nearblocks.io/txns/AUyw7KjqweNGSMD7ChYh7MJGMthQXTJhFqQzfEMZzZ3c) (expected prepaid-gas revert). `add_version` [`FXbXhGNi…`](https://nearblocks.io/txns/FXbXhGNirZCkiP2bx1aiBFQL3Q1EHFMpniJTY579oGWN). Live info call [`7882f97a`](https://api.outlayer.ai/attestations/by-call/7882f97a-06e5-46d3-9e58-5fe6428fb187), attestation 1246133. Adds the security review fixes R1 to R4.

### Previous version `6367401a`

Build `6367401a78ae4f193eae16f90925968e8c3b477f1a387a213540aa0c60479693` (680,154 bytes). FastFS upload [`oGGRn6jW…`](https://nearblocks.io/txns/oGGRn6jWffHF8GpryWMhMsGETLYRhL8RWzTC1dbWQoF) (expected prepaid-gas revert). `add_version` [`AJWVEN6F…`](https://nearblocks.io/txns/AJWVEN6FfQaE3ZE3V7KDHj1BtzCKTx3iMH3tx8CLYqKx). Live `info` call [`f4768da8`](https://api.outlayer.ai/attestations/by-call/f4768da8-2e87-4622-8654-d1e67f6cd1f0), attestation 1227292. Adds signed PnL, request binding on every signed answer, locked_until_ms in status and the sub-cent amount fix.

### Previous version `67c5cd77`

Build `67c5cd77a46814e5a4286b0a6971f8bc533274b425e7fb3272be3145469e65b2` (668,482 bytes). FastFS upload [`4Wz1EUh1…`](https://nearblocks.io/txns/4Wz1EUh1SFPvnYGRyMKWXeDhFfE4ZD6y5hsH5WWgwwgk) (expected prepaid-gas revert). `add_version` [`86tCjm92…`](https://nearblocks.io/txns/86tCjm92yBqKoHt2kz99es1NadZeKf91AfUTx2uaqfmr). Live `info` call [`0f0bf448`](https://api.outlayer.ai/attestations/by-call/0f0bf448-1b66-4200-b6de-7cf095aead54), attestation 1225814, `executed_wasm_sha256` `67c5cd77…`. Deploy cost 0.008253 NEAR.

### Previous version `38bd67b9`

Build `38bd67b930ea829cd0fdfad1c09d9d6b93e12f422c8c58a5c84b6899be9f5c78` (651,989 bytes). `add_version` [`9pk1mDC1…`](https://nearblocks.io/txns/9pk1mDC1dxzTXE7H7mHLXVVckHMEmRA4VnfxfxAzdb2z). Live `info` call [`763812bc`](https://api.outlayer.ai/attestations/by-call/763812bc-0012-4528-a45d-66a3ce17cae9), `executed_wasm_sha256` `38bd67b9…`.

### Previous version `b3fa1a39`

Build `b3fa1a394bceca3dc34efd044e430498d7d3bb9c5032290eaab87021fda2388a` (620,067 bytes). FastFS upload [`72P1YcuV…`](https://nearblocks.io/txns/72P1YcuVUJD3pX9dTnkNzii2gx3jFEcvBrAKDKVo2XR8) (expected prepaid-gas revert). `add_version` [`B3x8cU6G…`](https://nearblocks.io/txns/B3x8cU6GH25cPDxNZ56mP4fACRuqXUbopobeJxR11kCU). Live `info` call [`9d19bceb`](https://api.outlayer.ai/attestations/by-call/9d19bceb-986b-4745-9bf9-91f7dcb62b6e), attestation 1189623, `executed_wasm_sha256` `b3fa1a39…`. Deploy cost 0.008012 NEAR.

### Previous version `f13efe92`

Recorded 2026-10-28, after the worker payment balance was funded. `./verify.sh` on each call printed `executed == published build f13efe92` (`f13efe92613284bac3a4d09b1e8eca45d0f36a84ec238be125975a8eca28119c`). That build is superseded by `b3fa1a39`. The attestation response has no output body, so the result column is the recorded outcome of that call.

| Call | Result | Attestation |
|---|---|---|
| `info` | worker info | [`d03f935f`](https://api.outlayer.ai/attestations/by-call/d03f935f-dfc4-4548-8109-b9aabb5560fc) |
| `status` | Bronze, tier 1. Caps are $1 per trade and $5 per day | [`7d42db8d`](https://api.outlayer.ai/attestations/by-call/7d42db8d-d786-457f-b505-a96359f82393) |
| quote of 2 USDC | refused `over_cap_per_tx`: amount $1.99 exceeds the per-trade cap $1.00. No funds moved | [`c23f7bbf`](https://api.outlayer.ai/attestations/by-call/c23f7bbf-c37c-4327-8edd-e773d3a8324f) |
| `swap` 0.01 wNEAR → 0.046955 USDC | recorded fill. Intent `6eDwG5Am8GHwcK5umz9W4zgtLMjPCoFrZ87NpnkP7UuA` | [`7f52f7d8`](https://api.outlayer.ai/attestations/by-call/7f52f7d8-e4f6-4290-97e8-0754b90bcfc8) |
| over-cap swap | recorded refusal `over_cap_per_tx` | [`fffe6327`](https://api.outlayer.ai/attestations/by-call/fffe6327-2e0c-47c5-9942-bf785c8c152a) |
