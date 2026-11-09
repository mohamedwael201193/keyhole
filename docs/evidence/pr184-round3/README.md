# PR184 round-three regression evidence

Local source + isolated NEAR sandbox only; no mainnet, merge or deployment.

## Outcomes

- Contract: **255 PASS** (246 baseline + 9 permanent review regressions), strict pinned Rust1.86 clippy PASS.
- Sandbox: **32 PASS** (all 28 original cases + 4 permanent round-three runtime tests).
- Exact normal artifact: **438,062 bytes**, SHA256 `4a0d1a857ce2055238a078273ad0be21a70b97cc69d4d2ea81a6242a233df0e2`. A second normal build from final source compares byte-for-byte equal. The callback-loss fixture is deliberately different and is never the release artifact.
- Offline claims: **516 total, 216 PASS, 0 FAIL, 0 ERROR, 300 SKIP**.

`unit-before.txt` retains the independent probes against the reviewed base: 4 pass, 3 fail. `unit-after.txt` is the complete green suite after correction; `sandbox.txt` and `clippy.txt` retain executable evidence. These are implementation-run regressions, not a new independent audit.

## Finding-to-proof mapping

1. **R3-M01:** absent/stale settlement returns false without changing title or newer pending state. Original timeout probes are permanent; both timeout/resolver orders assert boolean and ownership. `review3_timeout_late_real_resolver_returns_false_with_and_without_new_transfer` runs actual yield/resume chains against the normal WASM. A test sender callback records the actual final NFT promise boolean, avoiding transaction-status polling of an unresolved yield. It verifies false after title timeout, false with a newer transfer pending, unchanged newer reservation/title, and true when the newer legitimate acceptance commits.
2. **R3-M02:** sale/bond/buyer/royalty refunds are atomically backed pull credits, including before pledge migration. A deleted seller retains the exact **1.01 NEAR** price + listing bond; recreation can cash it out. Runtime cashout-recipient deletion with real failure restores the credit once. Real failure with lost callback and real delivery with lost callback both remain pending/reserved; repeat claim fails. Treasury balance-history regression reserves the seller money rather than treating it as free attributed treasury. All analogous user-native refunds were inventoried and routed through the same ledger (see SECURITY.md).
3. **R3-L01 evidence:** the no-consumer mocked-result unit case is replaced with an actual rejected title-timeout invocation and narrower name. Mocked payout/treasury cases are labelled mocked. The existing runtime removed-ABI tests remain separate from these unit properties. Additional permanent opposite-result/new-nonce checks preserve the pending payout and available concurrent credit.

## Reproduce

```bash
(cd contracts/keys && cargo test --locked && cargo clippy --locked --all-targets -- -D warnings -A clippy::manual_range_contains)
(cd contracts/keys && ./build.sh && cmp target/near/keyhole_keys.wasm release/v2.5/keyhole_keys.wasm)
(cd contracts/keys && ./build.sh --features callback-failure-fixture && cp target/near/keyhole_keys.wasm ../keys-sandbox/tests/fixtures/callback_failure.wasm)
(cd contracts/keys-sandbox && cargo test --locked)
python3 judge/gen-claims.py .
node judge/verify-claims.mjs --offline
```

The committed test-only yield fixture can be rebuilt with `cd contracts/keys-sandbox/yield-receiver && cargo build --locked --release --target wasm32-unknown-unknown`; its crate/toolchain/lockfile are included. The fixture has deliberately unsafe test-only sender controls and must never be deployed to a live account. Runtime accounts, faults and balances in the logs are disposable sandbox data. Release caveats and the historical-refund reconciliation boundary are in SECURITY.md.

Sources cross-checked: [NEP171 final resolver boolean](https://nomicon.io/Standards/Tokens/NonFungibleToken/Core) and pinned near-contract-standards5.17.2 mint/approval/refund helpers. Historical deployed artifacts are unchanged.
