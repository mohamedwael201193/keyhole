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

Not recorded in this change. When the worker payment balance is funded, put the attested call here: call id, `executed_wasm_sha256`, and the attestation URL for an `over_cap_per_tx` refusal. Until that call exists, the local test above is the check.
