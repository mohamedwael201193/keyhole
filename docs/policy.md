# Spending policy

The tier caps are a policy inside the TEE worker. They are not a second contract. `limits_for_tier` in [`tee/worker/src/lib.rs`](../tee/worker/src/lib.rs) returns the numbers, and `enforce_caps` refuses the call before a swap is sent.

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

Recorded 2026-10-28, after the worker payment balance was funded. `./verify.sh` on each call printed `executed == published build f13efe92` (`f13efe92613284bac3a4d09b1e8eca45d0f36a84ec238be125975a8eca28119c`).

| Call | Result | Attestation |
|---|---|---|
| `info` | worker info | [`d03f935f`](https://api.outlayer.ai/attestations/by-call/d03f935f-dfc4-4548-8109-b9aabb5560fc) |
| `status` | Bronze, tier 1. Caps are $1 per trade and $5 per day | [`7d42db8d`](https://api.outlayer.ai/attestations/by-call/7d42db8d-d786-457f-b505-a96359f82393) |
| quote of 2 USDC | refused `over_cap_per_tx`: amount $1.99 exceeds the per-trade cap $1.00. No funds moved | [`c23f7bbf`](https://api.outlayer.ai/attestations/by-call/c23f7bbf-c37c-4327-8edd-e773d3a8324f) |
