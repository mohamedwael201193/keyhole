# PR #184 round-four storage-funding fix — local/source evidence

R4-M01 reproduced at `d5a3e410971c7d99b52600b9f70846d24f52076c`: the three unchanged reviewer unit probes returned **2 PASS / 1 FAIL** on unpaid dust storage ([before-unit.log](before-unit.log)). The correction is an explicitly prepaid permanent payout slot, not discarded dust or a return to untracked push refunds. No mainnet transaction, deployment, merge, live custody proof or production-readiness claim follows.

## Decision and measured bound

Public payable `register_payout_account(account_id?)` requires the exact `payout_storage_cost()`: **320 storage bytes**, currently **0.0032 NEAR**. Registration can be sponsored. The fee is separate/nonrefundable and never reduces principal, seller/bond proceeds or buyer change. Slots remain after successful cashout and are reused forever; there is no unregister path that could remove backing during an unknown payout.

New credit cannot allocate a ledger. Credit-producing roles must register before use; an unregistered overpayment buy reverts atomically with title, listing and deposit unchanged. A registered buyer retains the full **2-yocto** refund and can claim it. Existing available/pending credit cannot be overwritten by duplicate registration. Exact-price buyers without a refund need no registration. See [SECURITY](../../../SECURITY.md#round-four-payout-storage-budget-and-onboarding-undeployed-candidate) for client rollout, nonrefundable fee consent, legacy approval onboarding, older undeployed candidate state and unresolved financial callback-loss caveats.

The maximum-length (64-byte) account test measures **127 bytes** initially and **281 bytes** for the ledger plus pending payout and both first-use pre-migration aggregate/nonce keys. This is below its own **320-byte** paid budget. Pending expansion is24 bytes; both fixed keys cost130 bytes globally, not per account. Unknown pending state, new credit while pending, genuine failure/retry/success and empty-slot reuse stay within the prepaid capacity. Registration also checks measured initial growth plus these allowances in production.

## Permanent regressions / full suites

- **260 contract tests PASS**, including all255 prior tests and5 round-four cases: the reviewer's stale-result matrix and exact pre/post-migration sale totals, the20-identity attack with paid storage, unregistered-buy rejection and maximum-capacity/fee/duplicate/pending reuse. [unit.log](unit.log), [unit-probes.log](unit-probes.log).
- **35 local NEAR sandbox tests PASS** =3 resolver/gas +14 pledge/fault/captured-state +4 round-three +3 round-four +11 historical upgrade cases. [sandbox.log](sandbox.log). The runtime round-four cases retain the real failed seller cashout/recreated account test,4 fresh-identity sale/gift/full seller-cashout cycles, and registration/refund rollback plus a complete2-yocto cashout.
- Generated claims:517 checked,217 PASS,0 FAIL,0 ERROR,300 offline SKIP ([claims.log](claims.log)); deployed identity consistency PASS ([identity.log](identity.log)).
- Strict Rust1.86 clippy PASS: [clippy.log](clippy.log). No npm installs; existing Cargo targets reused. Sandbox custody/fault contracts remain explicitly test-only.

Every attack cycle asserts new funds cover new state **and** outstanding monetary liabilities after returning the seller's full consideration/bond. The runtime includes real native delivery and contract gas rewards:

| Case | New persistent storage | Storage stake | New retained funds | Still owed |
|---|---:|---:|---:|---:|
| Unit,20 fresh buyers |1,500 bytes|0.015 NEAR|64,000,000,000,000,000,000,080 yocto (0.064 NEAR +80 yocto)|40 yocto|
| Runtime,4 fresh buyers |312 bytes|0.00312 NEAR|14,302,056,100,870,800,000,016 yocto (includes gas rewards)|8 yocto|

The four runtime registrations alone pay0.0128 NEAR, independently of rewards or old reserve. Exact byte/reward measurements depend on account IDs/runtime. Each cycle leaves full buyer dust, zero seller credit and title back with the seller. Real failed seller cashout restores **1.01 NEAR** and later delivers after account recreation; unknown outcomes remain locked rather than restored without evidence.

## Artifact and captured-state funding

Normal release: **442,777 bytes**, SHA256 `632978e18daef174a77dbc5f5a5e0809ef191e42800fe9dd3bede08b2621ed3a`. [build.log](build.log), [artifact-abi.json](artifact-abi.json), [results.json](results.json). Its71 function exports match71 ABI methods, including the3 storage APIs; `reconcile_terminal_outcome` and `on_principal_paid` are absent. Artifact output was isolated from mutable shared `target/near` before copying the production release. A second local normal rebuild byte-matches the preserved release ([rebuild-confirm.log](rebuild-confirm.log)); CI independently rebuilds and compares the committed SHA.

Fault-only WASM:440,347 bytes, SHA256 `820e2605839938dd54eeac0b53b670ee7caebde65d3cf080bd84f123c139c5e0`; never a production release. [fault-build.log](fault-build.log).

The captured v2.4 account remains underfunded for the larger code. This local captured-state deployment fails `LackBalanceForState`, short0.833082986106337637378339 NEAR including that attempt's gas; the separate static code-only calculation is in [storage.json](../pledge-oracle-free/storage.json). A sandbox-only2-NEAR top-up then preserves all6 captured titles/config with lending OFF. This is not a current mainnet funding quote or approval to deploy/fund/migrate.

## Reproduce

```sh
cd contracts/keys
cargo test --locked
cargo test --locked review4_ -- --nocapture
cargo clippy --locked --all-targets -- -D warnings -A clippy::manual_range_contains
./build.sh --out-dir /tmp/keyhole-r4-normal
# Compare the output SHA with release/SHA256SUMS; preserve the normal artifact.
./build.sh --features callback-failure-fixture --out-dir /tmp/keyhole-r4-fault
cp /tmp/keyhole-r4-fault/keyhole_keys.wasm ../keys-sandbox/tests/fixtures/callback_failure.wasm
cd ../keys-sandbox
cargo test --locked -- --nocapture
```

Set `CARGO_TARGET_DIR` to an existing compatible cache when space is limited. Do not identify artifacts from a shared mutable `target/near` output, especially after a fault build. All unit fixture onboarding pays the public registration fee explicitly; attack identities are not silently registered in a generic context helper. Historical evidence in `pr184-round3/` is not relabelled as this artifact's execution.
