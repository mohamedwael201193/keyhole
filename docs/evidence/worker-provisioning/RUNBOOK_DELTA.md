# Exact delta to WORKER_AND_LOANS_RUNBOOK.md

This is a future execution plan, not authorization or a record of mainnet actions.

## Replace publication preparation

Use checkout `R=/workspace/near_hackathon/wt_worker_prov` and the hash/byte length in [candidate.json](candidate.json), not the historical checkout or `59379cfe`. Build twice and require byte identity and exact-head independent review. Add the separately approved reviewer public key to the existing default enclave secrets as `COLLATERAL_AUDITOR_PUBLIC_KEY` (base64 32-byte Ed25519 public key, not a private key). This key is **not** the immutable loan-certificate attestor; no migration/minter/attestor replacement occurs.

Follow the five-native-transaction batched plan in [RESEARCH.md](RESEARCH.md) and [publish-plan.json](publish-plan.json). The publication snapshot has 22 old versions. Refresh it, maintenance/drain approvals and native balances before signing. One new active registration plus removal of exactly those 22 leaves count 1. Preserve project ID, UUID and nonce-1 payment-owner storage. `GUARDED_WORKER_HASH` must be the new candidate hash. The official CLI secret merge's 0.1 attachment is refundable excess/storage, not a burned fee; it still needs native capital and any applicable all-in transaction-ceiling approval. Never run any NEAR payment-key top-up.

## Replace every HTTPS compute flag

`--compute-limit 1000000000` → **40000 for the first info call, 10000 thereafter**. In CLI HTTPS mode this is microUSD, not instruction count. Keep `--async`, exact `--version`, existing payment owner nonce 1, `--secrets-profile default --secrets-account keyhole-devmo.near`; no developer `--deposit`. At most 20 paid calls in total, aggregate authorization ≤$0.23. Poll existing call IDs using GET, never resubmit a pending call. No top-up now.

## Replace the missing provisioning step (§4 and setup step 3)

All following parameters are inside a fresh holder's NEP-413 signed request, same as normal worker operations. These operations are intentionally **direct worker operations**, not additions to the public web gateway allowlist. Sessions and EIP-191 cannot authorize provisioning. The caller supplies no wallet key, arbitrary policy, arbitrary ciphertext or minter signer.

1. Fresh dedicated token, verified team holder and `owner_epoch`; minter payout slot registered; canonical wallet established with normal `account`. Never use a previous holder alias.
2. `prepare_collateral` params:
   ```json
   {"token_id":"ACTUAL_TOKEN","owner_epoch":"ACTUAL_EPOCH","approvers":[{"id":"ACTUAL_REACHABLE_REVIEWER.near"}],"threshold":1}
   ```
   It requires no binding/provider policy and zero loan/value/listing/transfer locks. It constructs the restricted policy, locks new custody sends locally, calls provider encryption/signing inside the enclave, verifies the exact wallet/caller/locked/version/expiry signature, and seals the plan. Return `provision_id`, wallet/ciphertext/plaintext hashes and expiry; never return the reusable signature/API key. A lost POST is UNKNOWN, not permission to create another plan. It does not register anything on chain.
3. `collateral_quote` params `{token_id,owner_epoch,provision_id}` returns real `provider_quote_yocto=Q`, exact `binding_deposit_yocto=0.02+Q`, beneficiary and ciphertext byte length, using the actual sealed artifact. Preserve output attestation/finalized observations. Public size probes are not this quote.
4. Independent reviewer audits actual full authority history and effective policy, including reachable quorum, aliases, old jobs and presigned/external-chain/MPC authority. Retain a real report with digest `authority_audit_sha256`. The configured reviewer signs exact UTF-8 bytes `KEYHOLE_COLLATERAL_AUDIT_V1\n{audit_message}` with Ed25519. The JSON message has exactly the `AuthorityAudit` schema in [collateral.rs](../../../tee/worker/src/collateral.rs), domain `KEYHOLE_COLLATERAL_AUDIT_V1`, project UUID, keys contract, `provision_id`, report digest, issued/expiry unix seconds (at most 900 seconds), and all six independently verified authority/policy/quorum declarations true. A digest or a holder's Boolean alone authorizes nothing. No fixture report/key is accepted in production.
5. `provision_collateral` params:
   ```json
   {"token_id":"ACTUAL_TOKEN","owner_epoch":"ACTUAL_EPOCH","provision_id":"ACTUAL_PREPARATION_ID","audit_message":"EXACT_REVIEWED_JSON_STRING","audit_signature":"BASE64_REVIEWER_SIGNATURE","max_deposit_yocto":"ACTUAL_APPROVED_D"}
   ```
   Verify audit signature against the pinned enclave public key, exact plan/owner epoch/build, current inventory and absence of policy/binding. Requote Q with minter beneficiary and enforce signed maximum D, native storage backing, gas/reserve and transaction ceiling. Existing enclave-only minter signs `register_collateral` with **200 Tgas and exactly D**. Persist the exact original transaction hash before broadcast. Never auto-cashout, refund, retry binding, call `check_collateral`, replace an UNKNOWN send, or obtain the minter private key.
6. If not immediately terminal, `reconcile_collateral` params `{token_id,owner_epoch,provision_id}` only GETs the original native transaction and reads current chain/provider inventory. Exact original transaction/actions/arguments/deposit, `FINAL`, terminal Boolean true, terminal receipt lineage, pending registration absent, binding ready, controller, locked policy/version/ciphertext hash and canonical wallet must all match. The decrypted effective `/wallet/v1/policy` must also equal the prepared restricted policy, capabilities and authorized keys. Only then the reviewed writer seals `t/<token>/confinement_v1`, once; conflicting writes fail. This is the row consumed by existing `loan_certificate`.
7. A real terminal failed registration releases only the minter nonce latch and reports `FAILED_LOCKED`; it does not create eligibility or retry. UNKNOWN keeps all relevant locks. Lost preparation/ownership changes need an independently reviewed recovery, not a guessed reset. Release gates are in SECURITY.md.

## Replace exit-quote workaround (§5 setup step 5)

Use holder-authenticated `withdraw_dry_run` params `{token_id,owner_epoch,chain:"near",token:USDC,amount:"100000",to:CURRENT_HOLDER}`. It is a provider preview without signing/broadcasting a withdrawal or spending admission/budget. Require positive output/minimum, actual route deadline and receiver-specific fees/registration deduction; separately prove cooldown and approval executability. It does not accept a lender's address as an ordinary holder self-exit. Quote L again once L really becomes the holder after default.

## Keep unchanged

Keep lending disabled until every live policy/authority/route/attestation gate passes. A repay, debt-on-native-delivery, B related-party default, exact epochs, holder-only ordinary exits, lower freeze/thaw, pull payouts, nonce-bound reconciliation and UNKNOWN semantics are unchanged. Never call `new()` or legacy `migrate()` on the live account; the already-completed `migrate_pledge` is not repeated. The 13-FINAL-transaction funded acceptance remains a separate existing proof and is not relabelled as this pilot.

## Release checklist

The source blocker is implemented. Use the release checklist and trust boundaries in [SECURITY.md](../../../SECURITY.md). Candidate identity remains separate from live identity.
