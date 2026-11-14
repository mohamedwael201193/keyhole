## Pledge reproduction — source candidates and generated live identities

This local stack combines admission, guarded custody, serialized policy commands, the client preview, blinded provenance, protected sales and delivery-gated lending. The generated identity block above distinguishes the actual live contract/worker from the owner/epoch-CAS source candidates. `identity.json` pins each identity independently. Lending and both Pledge write flags remain off.

- Contract admission binds the current holder, ownership epoch, exact operation ID and action hash. The worker's ordinary withdrawal uses the same begin_value_op/finish_value_op driver as guarded value operations; there is no direct legacy withdrawal POST. Only the current holder's own NEAR account is a permitted withdrawal destination, including at durable provider dispatch.
- Custody freeze/thaw uses the documented Boolean ABI, with one outstanding command. Both the exact genuine terminal callback and a matching policy read are needed before another command. Epoch-keyed ten-minute cooldown handles A→B→A without resetting token-wide daily spend.
- Loan funding creates backed borrower credit in DisbursementPending with due_ns=0. Only the exact principal cashout's genuine successful native callback activates Active debt and starts the agreed term. Failed native delivery restores credit without starting debt; UNKNOWN does not start debt or allow a new send.
- The refundable loan bond is 0.009 NEAR (`LOAN_STORAGE_DEPOSIT`). The contract accepts any term from 1 second to 30 days and grace up to 7 days; the reviewed offline plan uses a 7200-second term plus 900-second grace. Per-action amounts: [docs/COSTS_AND_RISK.md](../docs/COSTS_AND_RISK.md). The permanent payout slot is a separate nonrefundable 320-byte charge (0.0032 NEAR at the tested byte price); duplicate registration rejects atomically without erasing credit or charging twice.
- Loan floor certificates use KEYHOLE_SEALED_LOAN_V3_DELIVERY and bind the raw USDC minimum, wallet, policy, holder, epoch, nonce, exact terms, network, contract and expiry. Protected sale certificates have a separate buyer-bound domain. Seller price credit and title settle in one local receipt; actual seller native cashout is separate.
- adopt_zero_royalty is an explicit owner-authorized source method. At zero, NEP-199 returns the entire declared balance to the seller. NEP-171/177/178 behavior remains covered by contract/runtime suites.
- V2 event commitments use secure random private openings and immutable encrypted rows. V1 history remains verifiable; holder history opens only that holder's rows. Public projections do not expose openings.
- The preview client keeps the floor public key and treasury/config fields, models DisbursementPending, and builds exact principal and bond deposits. Preview remains disabled by default.

Reproduce without wallets, deployments or spending. Use Node **22.22.2** (`web/.nvmrc`) and npm **10.8.2**, the same pinned pair as the web CI job:

```bash
export CARGO_BUILD_JOBS=1 NODE_OPTIONS=--max-old-space-size=3072
(cd contracts/keys && cargo test --locked && cargo clippy --locked --all-targets -- -D warnings -A clippy::manual_range_contains && ./build.sh)
# Fault injection is sandbox-only, never a release/deploy artifact:
(cd contracts/keys && ./build.sh --features callback-failure-fixture && cp target/near/keyhole_keys.wasm ../keys-sandbox/tests/fixtures/callback_failure.wasm && ./build.sh && cmp target/near/keyhole_keys.wasm release/v2.7/keyhole_keys.wasm && ./build-sandbox-delay.sh)
(cd contracts/keys-sandbox && ./build-policy-mock.sh && cargo test --locked -- --test-threads=1)
(cd tee/worker && cargo test --locked && cargo clippy --locked --all-targets -- -D warnings && cargo clippy --locked --target wasm32-wasip2 -- -D warnings && ./build.sh && node verify-log.mjs --self-test)
(cd web && npm ci && npm run lint && npm run typecheck && npm test && npm run build)
(cd cli && npm ci && npm test && npx tsc -p . --noEmit)
node --test scripts/pledge/*.test.mjs scripts/check-worker-candidate.test.mjs
node scripts/check-worker-candidate.mjs
node scripts/gen-identity.mjs --worker-candidate --contract-candidate --check
python3 judge/gen-claims.py .
node judge/verify-claims.mjs --offline
```

The runtime suite uses real local NEAR receipts with labelled custody/transport mocks. [Current repair proof and finding map](../docs/evidence/worker-provisioning/R4.md) · [Live identities](../README.md#live-mainnet-identities) · [Historical profiling](../docs/evidence/integration-stack/contract-size.md).
Safety and release status: [SECURITY.md](../SECURITY.md#two-sided-pledge-ui-release-gate).

Before a public loan exists the floor is **Declared, not yet verified**. An open offer that is not yet checked says **Minimum to verify · not a current balance**. After the pinned Ed25519 signature and exact final-chain loan template verify, the live page says **Verified minimum · sealed signature verified**. A funded loan shows **Loan minimum · not a current balance**. None of these is a fresh balance, and an expired proof is not relabelled as one. The canonical encoding/signature test consumes the contract/worker's [V3 delivery-domain Borsh vector](../protocol/loan-certificate-v3-delivery.json). The public request accepts only token ID and loan nonce, never another asset or minimum.

The shared app shell exposes **Claim your funds** for available native credits. It reserves a versioned local pending operation before opening the connected wallet, never silently retries UNKNOWN, and checks final receipt sender/contract/method/deposit/gas/arguments plus a post-dispatch block before accepting a returned hash. Contract pending payouts still block retries. `NEXT_PUBLIC_PLEDGE_TRANSACTIONS` is a separate default-OFF write gate. [Tests](../web/tests/pledge-money.test.ts).

Clean checkouts, CI and the isolated box install use `cd web && npm run build` with the normal project root. Linked-dependency worktrees may explicitly set `KEYHOLE_TURBOPACK_ROOT` to their common checkout/dependency parent. Use Node 22.22.2 (`web/.nvmrc`) and npm 10.8.2; [dependency compatibility proof](../docs/evidence/integration-stack/wallet-dependencies-r4.md) covers clean installation and wallet schemas.

The historical [two-team-account repay/default runbook](../docs/pledge/TEAM_RUNBOOK.md) specifies public methods, tiny amounts, native cashout proof, real-chain waiting, ordinary self-exit and cost ledger. The current [scoped native A/B runbook](../docs/worker/LIVE_LOANS_EXEC.md) proves repayment/release and default NFT title/control without public FT redemption. Release gates: [SECURITY.md](../SECURITY.md#pledge-pilot-release-gates).



### Integrated client continuity proof

The v2.5 client binds final owner epochs before signatures, recovers the original custody journal across refreshes, and exposes separately consented payout-slot registration and native-credit cashout. The minter checks its prepaid slot before mint dispatch. Release byte identity is generated by `node scripts/gen-identity.mjs` in [`release/v2.5/identity.json`](../contracts/keys/release/v2.5/identity.json); the historical rollout matches that release. [Independent artifact reproduction](../docs/evidence/integration-stack/artifact-repro-r2.json) records the two clean Linux builds and measured code storage. Regressions: [`integration196.test.ts`](../web/tests/integration196.test.ts), [`client-owner-epoch.json`](../protocol/client-owner-epoch.json), and the named terminal-history and ordinary-payout runtime tests. [Trust and rollout details](../SECURITY.md#integrated-client-recovery-and-ordinary-payout-rollout).
The provider mock exposes the same Boolean freeze/thaw argument shapes as the public provider contract. Native tests exercise exact-command callbacks, duplicate/late callbacks, delayed reads, terminal failures and restart. Sandbox fault builds exercise a provider mutation whose callback fails; the outstanding command remains durable across a return to the normal binary.

Withdrawal cooldown is keyed by **contract + token + authoritative ownership epoch**, not just the last logged account name. First final-chain observation of a new nonzero epoch durably arms ten minutes; A→B→A cannot reuse A's old record. Status/dashboard show the effective deadline and the normal POST boundary checks it again. No ownership observation deletes or resets the token-wide daily spent counter.

```bash
(cd contracts/keys && cargo test --locked custody && cargo test --locked policy)
(cd tee/worker && cargo test --locked ownership_sync && cargo clippy --locked --target wasm32-wasip2 -- -D warnings)
# For the complete normal-release + labelled mock/fault integration,
# use the single full reproduction fence under “Pledge preparation” above.
python3 judge/gen-claims.py && node judge/verify-claims.mjs --offline
```

The committed bytes in `release/v2.7` are the live contract. `release/v2.6` is the previous artifact. The callback-failure fixture and the short-delay fixture are generated only for sandbox tests. No mainnet calls or worker publication occur in these commands.


#### Guarded failure messages

The web error catalog gives actionable English status for pending/provisional ownership, stale sessions, self-exit-only destinations, changed quotes and unknown custody/admission outcomes. Unknown outcomes direct the holder to reconcile the existing operation ID rather than create another send.

```bash
(cd web && npm ci && npx vitest run tests/domain.test.ts tests/p2-errors.test.ts)
python3 judge/gen-claims.py && node judge/verify-claims.mjs --offline
```
