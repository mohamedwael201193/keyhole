# Oracle-free pledge remediation — source/sandbox only

No terminal attestor, public truth-selection ABI, recovery service or independent financial signer remains. The floor signer is not a native-payment oracle. Funding credits backed borrower principal and starts Active debt atomically; certificates use V2_CREDIT, not the old delivery-before-debt domain. Only genuine private host callback results can settle native cashouts. Lost native callbacks stay UNKNOWN/locked; this is a safety fix, not full financial liveness or keyless-complete production proof.

## Local validation

- 255 contract unit tests PASS (246 baseline + 9 round-three regressions), including 16 adapted round-two safe-property unit cases, malformed/byte matrices retained, consolidated-ledger concurrency, lazy borrower-funded loan storage and maximal provisional timeout.
- Strict pinned Rust clippy PASS.
- 32 real NEAR sandbox integration tests PASS:14 pledge/fault/fork tests,3 adversarial resolver tests,11 historical upgrades and4 round-three runtime regressions. Test-only custody extension/mock is explicitly not live proof.
- The exact old three-times1.1NEAR false-failure attack cannot restore paid credit: removed ABI calls and repeat claims fail while a genuinely lost native callback remains pending. A failed native payment with a deliberately lost callback likewise cannot manufacture available credit.
- First-stage callback loss recovers only via authoritative matching custody generation/provisioning metadata. Old freeze after committed thaw is rejected by the mock at custody mutation time.
- Permissionless NFT timeout restores only provisional title and late/stale resolvers conservatively return `false`; a receiver's external economic side effect remains, and accepted/newer title is not unwound.

## Concrete storage reduction

Normal release **438,062bytes**, SHA256 `4a0d1a857ce2055238a078273ad0be21a70b97cc69d4d2ea81a6242a233df0e2` (not the smaller fault fixture). Prior candidate458,449bytes: **20,387bytes /0.20387NEAR** less code storage. The earlier ABI-only experiment saved5,579bytes /0.05579NEAR; this candidate additionally removes the unsafe oracle and obsolete principal push ABI/phase, avoids generic panic formatting paths and consolidates new per-account available/pending credits into one lazy ledger. Empty map prefixes alone were never an allocation saving. The ledger avoids duplicate account-key entries when available and pending credit coexist, but does not claim every individual state is smaller.

The existing captured account still cannot fund code storage. Real captured-state sandbox deployment reports `LackBalanceForState` **0.785625312346349137378339NEAR** short, including that attempt's gas (previous oracle-free candidate about0.792NEAR). [Machine-readable calculation](storage.json) separately records the static code-only deficit, not conflated with execution gas. Only a sandbox2NEAR top-up continues migration and verifies all6 captured titles/config remain unchanged; lending stays OFF and legacy money remains unattributed. New loan records are allocated lazily and measured against the borrower's attached refundable bond. No real top-up/deploy/publish/key or version change is performed.

## Remaining STOP gates

New custody `set_wallet_frozen` monotonic-generation enforcement and atomic registration nonce/deposit metadata are source/mock extensions. Legacy/unsupported providers fail closed; live OutLayer support is NOT proven. Unknown native cashout/treasury outcomes and unknown failed registration refunds remain locked without a reviewed on-chain-verifiable design. Independent exact-head review, live confinement, operational longevity and separate rollout approval are still required. No claim of deployment readiness, operator resistance or FullAccess-removal readiness follows from these tests.


## Round-three refinements

The 16 round-two cases are adapted unit properties, not 16 original malicious-oracle runtime scenarios. The unused mock-result test was replaced by an actual rejected title-timeout invocation with a narrow name; production removed-ABI runtime calls remain separate evidence in `contracts/keys-sandbox/tests/pledge.rs`. Mocked payout/treasury tests now say mocked. Timeout order matrices assert returned boolean as well as ownership/reservations. The permanent `pledge_review_round3_tests.rs` retains the independently failing timeout and treasury postconditions plus contrary/stale/new-nonce payout, repay/default, all-refund and pre-migration-credit cases.

Sale proceeds and listing/buyer/royalty refunds now use the same pull ledger as loans. Mint/approval/admission refunds were inventoried and routed through it too. Deleted sellers retain their 1.01 NEAR price+bond credit, including before pledge migration; migration imports pre-existing aggregate credits/nonces instead of erasing them. Historical and callback-loss caveats are recorded in SECURITY.md.

[Round-three exact-artifact logs and reproducers](../pr184-round3/README.md).
