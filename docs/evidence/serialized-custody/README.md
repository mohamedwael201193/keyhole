# Serialized Boolean custody — local source candidate

Measured 10 November 2026, Africa/Cairo. No deployment, provider mutation on mainnet, worker publication, version retirement, key change or merge.

## Executed validation

- 254 contract unit tests PASS, including eight new command/receipt/restart tests.
- 586 worker unit tests PASS, including eleven immutable epoch cooldown tests.
- Strict native and WASI worker clippy, strict all-target contract clippy PASS.
- 31 sandbox tests PASS: 3 bounded-resolver gas tests, 17 pledge/cross-layer tests, 11 historical migration/upgrade tests.
- Real local NEAR runtime executes the controller calls and callbacks. Provider cryptography/HTTP/registry/eligibility remain explicitly mocked.
- Real sandbox callback panics after a successful freeze and after a successful thaw leave UNKNOWN commands locked. Restoring the normal binary cannot clear an unknown command; a Boolean read cannot authorize a retry/opposite command. Registration callback loss likewise retains the forwarded liability.
- Normal provider model exposes `freeze_wallet(wallet_pubkey)`, `unfreeze_wallet(wallet_pubkey)` and versioned policy reads, no generation/idempotency extension. A terminal failure plus completed mismatching read permits a fresh local sequence; incomplete action/read stages do not.
- Read-only reconciliation is available only after the exact action callback records terminal completion. Old/duplicate callbacks and reads cannot settle a newer sequence.

## Artifact identity

- Normal contract: **437998 bytes**, SHA256 `c7d943992de1de8574323c6446e8aa4b2b249659a7c89d19a124ad21e6eb2a95`.
- Normal worker: **878011 bytes**, SHA256 `5b8d79c8f5ebda5d454b76122041d3445b809cd5504ec9c76032864d2a5aea86`.

The captured-account sandbox rerun measured a `LackBalanceForState` shortfall of **0.784981136074739537378339 NEAR**, including that local execution, for this artifact. It is not an integrated-candidate/mainnet quote.

The injected-callback fixture is separate and must never be deployed. The captured-account storage estimate is in [the measured JSON](../guarded-worker/storage.json); it excludes fresh-network gas and migration and is not a mainnet funding quote.

## Reproduce without keys or funds

```bash
(cd contracts/keys && cargo test --locked && cargo clippy --locked --all-targets -- -D warnings -A clippy::manual_range_contains && ./build.sh)
(cd contracts/keys && ./build.sh --features callback-failure-fixture && cp target/near/keyhole_keys.wasm ../keys-sandbox/tests/fixtures/callback_failure.wasm)
(cd contracts/keys-sandbox && cargo test --locked)
(cd tee/worker && cargo test --locked && cargo clippy --locked --target wasm32-wasip2 -- -D warnings && ./build.sh)
python3 scripts/measure-contract-storage.py
python3 judge/gen-claims.py && node judge/verify-claims.mjs --offline
```

No secret is needed. Sandbox uses test accounts and sandbox currency only. These source tests do not establish deployed-bytecode parity, absent resting orders/signatures, live lower refusal or independent-review acceptance. See [SECURITY](../../../SECURITY.md) for the remaining authority/liveness boundaries.
