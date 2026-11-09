# Oracle-free pledge remediation — source/sandbox only

No terminal attestor, public truth-selection ABI, recovery service or independent financial signer remains. The floor signer is not a native-payment oracle. Funding credits backed borrower principal and starts Active debt atomically; certificates use V2_CREDIT, not the old delivery-before-debt domain. Only genuine private host callback results can settle native cashouts. Lost native callbacks stay UNKNOWN/locked; this is a safety fix, not full financial liveness or keyless-complete production proof.

## Local validation

- 246 contract unit tests PASS, including all16 independent round-two scenarios ported to safe postconditions, malformed/byte matrices retained, consolidated-ledger concurrency, lazy borrower-funded loan storage and maximal provisional timeout.
- Strict pinned Rust clippy PASS.
- 28 real NEAR sandbox integration tests PASS:14 pledge/fault/fork tests,3 adversarial resolver tests,11 historical upgrades. Test-only custody extension/mock is explicitly not live proof.
- The exact old three-times1.1NEAR false-failure attack cannot restore paid credit: removed ABI calls and repeat claims fail while a genuinely lost native callback remains pending. A failed native payment with a deliberately lost callback likewise cannot manufacture available credit.
- First-stage callback loss recovers only via authoritative matching custody generation/provisioning metadata. Old freeze after committed thaw is rejected by the mock at custody mutation time.
- Permissionless NFT timeout restores only provisional title; a receiver's external economic side effect remains, and accepted/newer title is not unwound.

## Concrete storage reduction

Normal release **438,692bytes**, SHA256 `42d738abac7f7562e437c31d6c281ca491020328004f0973ec6970c464e60a2a` (not the smaller fault fixture). Prior candidate458,449bytes: **19,757bytes /0.19757NEAR** less code storage. The earlier ABI-only experiment saved5,579bytes /0.05579NEAR; this candidate additionally removes the unsafe oracle and obsolete principal push ABI/phase, avoids generic panic formatting paths and consolidates new per-account available/pending credits into one lazy ledger. Empty map prefixes alone were never an allocation saving. The ledger avoids duplicate account-key entries when available and pending credit coexist, but does not claim every individual state is smaller.

The existing captured account still cannot fund code storage. Real captured-state sandbox deployment reports `LackBalanceForState` **0.791966422520006137378339NEAR** short, including that attempt's gas (previous candidate about0.991NEAR). [Machine-readable calculation](storage.json) separately records the static code-only deficit, not conflated with execution gas. Only a sandbox2NEAR top-up continues migration and verifies all6 captured titles/config remain unchanged; lending stays OFF and legacy money remains unattributed. New loan records are allocated lazily and measured against the borrower's attached refundable bond. No real top-up/deploy/publish/key or version change is performed.

## Remaining STOP gates

New custody `set_wallet_frozen` monotonic-generation enforcement and atomic registration nonce/deposit metadata are source/mock extensions. Legacy/unsupported providers fail closed; live OutLayer support is NOT proven. Unknown native cashout/treasury outcomes and unknown failed registration refunds remain locked without a reviewed on-chain-verifiable design. Independent exact-head review, live confinement, operational longevity and separate rollout approval are still required. No claim of deployment readiness, operator resistance or FullAccess-removal readiness follows from these tests.
