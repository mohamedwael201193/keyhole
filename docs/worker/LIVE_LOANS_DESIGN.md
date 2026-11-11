# Live loans: worker V2 evidence design

Read-only design followed by the requested local implementation. No worker publication, secret update or mainnet transaction is performed here. Source changes are for review; no worker publication. Contract v2.7 stays byte-identical. Team reviewer, not independent auditor. Credit: devmo.

## Decision and trust boundary
Current target: `native-A-repay-B-title-exact-near-exit`. A proves collateral
ingress, native principal delivery/repayment and pledge release, then exact USDC
self-exit. B proves default/title and the actual lender-holder's exact exit after
the owner-epoch cooldown. This candidate implements `exact-near-v1` as
`/wallet/v1/confidential/unshield` → read back own Intents credit →
`/wallet/v1/storage-deposit` → `/wallet/v1/intents/withdraw` (`chain: near`).
This is not live proof; no withdrawal or loan was executed by this implementation.
See [exact wire schemas, recovery, costs and trust scope](EXACT_NEAR_EXIT.md).
Authoritative docs: [Agent Custody](https://app.outlayer.ai/docs/agent-custody),
[wallet OpenAPI](https://api.outlayer.ai/openapi.json),
[confidential](https://skills.outlayer.ai/agent-custody/references/confidential.md),
[storage](https://skills.outlayer.ai/agent-custody/references/wallet-ops.md),
[withdraw](https://skills.outlayer.ai/agent-custody/references/intents-withdraw.md).
The historical `native-A-repay-B-title-no-public-redemption` scope is no longer
full acceptance. Legacy direct confidential withdrawals remain disabled.
GO for explicitly scoped TEE/provider-backed evidence; STOP for an unconditional claim that no provider-held alias/hidden signing authority exists anywhere. The API has no global alias enumeration. Fresh anonymous registration and never-exported credentials establish creation provenance inside the documented provider/TEE model, not a universal cryptographic negative. Project/contract administration and provider behavior remain trusted. No claim of guaranteed future guardian availability.

Current project keyhole-devmo.near/keyhole must retain UUID p000000000000004b, sealed namespace, existing immutable minter and certificate attestor. Lending stays OFF throughout release/enrollment. Old registered versions and already-dispatched jobs must be retired/drained. No contract deploy, governance staging/cancellation/acceptance/apply or key deletion.

## Phased protocol
1. New implicit borrower and Bronze NFT; strict fresh canonical anonymous provider wallet, no token or owner legacy wallet adoption. Claim token-scoped enrollment root before any provider POST, seal credentials and complete sanitized creation manifest. A lost register/encrypt/sign response is UNKNOWN, never automatic retry.
2. Fresh L/test_holder3 NEP-413 liveness challenge bound to project, contract, token, wallet, owner epoch, candidate-policy hash, worker hash, threshold1, nonce and deadline. FINAL access-key read proves that key is FullAccess. Candidate policy explicitly reviews guardian role admin: default signer cannot authorize policy updates.
3. Export authenticated exact policy plaintext for team review, but no API key/policy-write signature. PreAuditV2 covers only candidate policy, provenance, known authority paths, prior jobs and quorum identity. It MUST NOT assert installed effective policy reviewed.
4. Existing register_collateral protocol2, real exact ciphertext storage quote, immutable minter, owner/epoch CAS, native WAL original hash before broadcast. Preserve genuine provider callbacks and FINAL receipt lineage. Contract binding may now be ready, but worker eligibility MUST remain unsealed.
5. Reconcile original installation. Compare public outlayer.near get_wallet_policy controller/version/locked/ciphertext hash with authenticated keystore GET /wallet/v1/policy policy=stored and exact decrypted rules/approval/capabilities/authorized_key_hashes. Missing/unknown fields, policy=none, wrong control or pending inventories fail closed. Emit fixed typed EffectivePolicyReportV2 signed by existing minter with a distinct domain and authenticated output attestation. This is not a generic signing oracle.
6. Separate team reviewer inspects this actual report/plaintext, creation journal and authority inventory, then signs PostAuditV2 over report hash and all six precisely scoped assertions. Fresh rechecks at finalize, immutable V2 proof companion first; compatible confinement_v1 commit marker LAST. Certificate requires both. No V1 grandfathering or ABI/Borsh changes.

## Authority evidence
- no_presigned_authorities: fresh creation and complete authority-path/request inventory; first policy1 signature consumed by genuine install, next policy version2. Inspect terminal results for reusable signatures, not just pending0.
- all_aliases_reviewed: no token/legacy wallet before creation; sole never-exported API-key hash, exact installed authorized hash list, no exposed key-mint/bind/export path. Scoped to provider/TEE assumptions, not global alias oracle.
- old_jobs_drained: all request pages, open orders/pending approvals, native/provider WAL terminal, no control/payout/registration/value operation pending. Registered version count1 alone does not prove drained old jobs.
- external_chain_authorities_reviewed: fresh wallet provenance; no raw/EVM/Solana/sign_message/Intents/order paths; exact installed deny capabilities and complete known request outputs. No fabricated cross-chain absence oracle.
- effective_policy_reviewed: only post-install actual public+cipher/private decrypted readback equals exact reviewed plaintext and current binding.
- reachable_quorum_verified: actual fresh L NEP-413 signature, current FullAccess key and exact installed guardian role/threshold. Present control, not future availability or proven positive provider execution.

Never positively approve a sign-policy probe: it creates reusable version2 policy authority valid seven days, violating a literal zero-unconsumed-authorities claim. A rejection-only nonfinancial rehearsal is optional and must finish with no signature/pending request. No such probe is required or implemented in the minimal path.

## Source implementation map
tee/worker/src/collateral_evidence.rs: strict V2 signed types, canonical JSON/domain signatures, manifest/pre/post/report validation, token-scoped markers, proof-first/commit-last. collateral.rs retains Prepared serialization and loan certificate ABI; normalized admin guardian policy. collateral_host.rs splits prepare/pre install/reconcile/finalize; native_host.rs retains exactly-once original transaction checks. main.rs strict fresh creation operation and safe quote projection; guarded_host.rs requires V2 companion for certs and token-scoped lock for all outflows. No contract edits.

Token-scoped immutable enrollment claim blocks ordinary outflows/rebind/alias paths across owner epochs. Old-owner finalize denied after transfer. New current holder must refresh guardian/report/post-review bound to current control, while preserving original install epoch/hash; if unsupported fail locked rather than reinstall or escape. Every asynchronous marker write rechecks owner/control/registry. Existing wallets retain ordinary behavior, but cannot pretend to have fresh collateral provenance.

Required adversarial tests: replay/cross-domain audit; different plaintext/policy/cipher/wallet/project/token/hash/epoch; no post-review; signer instead of admin; wrong FullAccess key/guardian signature/nonce/deadline; changed owner mid-enrollment; marker before proof; tampered effective report; unknown/null policy fields; terminal reusable signature; pending/incomplete pagination; register/native timeout no resend; concurrent conflicting markers; companion/marker crash boundaries; old worker/two versions; certificate golden bytes unchanged. All existing worker tests remain passing. Claims and trust assumptions belong in SECURITY.md. Competitor names never enter repo/code.

## Release and operation order
Local build/review/tests -> maintenance/drain -> FastFS verified exact bytes -> one official secret MERGE (GUARDED_WORKER_HASH and reviewer public key only, preserving protected data/access) -> atomic add new active/remove actual old singleton -> verify UUID/minter/attestor/singleton -> mint/new wallet -> review candidate/provenance -> PRE-INSTALL Base deposit and genuine terminal credit -> guardian/prepare -> pre-review/quote -> genuine register_collateral -> fresh guardian plus signed decrypted-policy readback -> post-review/finalize -> lending ON -> A native repayment/cashouts/release -> B default/claim/new-holder title and confined-control evidence -> lending OFF.

Official secret update attaches0.1 NEAR+50T; approved exception but not executed here. Never use secrets set or reconstruct protected map. Unknown result means recover original, not retry. FastFS old1,085,333B artifact used2 chunks and burned0.005658436 NEAR; new build exact size first. Registry add_version same URL shape .0044 storage+100T, remove actual old version0+30T in one atomic transaction, not old22-version planner. Do not publish worker during active loans.

## Funding and costs
Public Base snapshot /workspace/handoff/BASE_FUNDING_PUBLIC_SNAPSHOT.json: account0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3 holds2.747904 native USDC and0.000100372662692192 ETH. Native Base USDC0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913. Canonical destination asset nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1.
Request confidential deposit/cross-chain quote for Base USDC amount900000, require min delivered800000, fresh actual address/expiry/destination commitment. Operator sends one exact ERC20 transfer, no unlimited approval. Verify FINAL Base Transfer and original OutLayer request terminal plus exact canonical confidential credit. Source send alone is not destination proof. Route503/no private route means STOP, no public fallback. Source visible/solver-visible, not absolute privacy. Base ETH gas separately disclosed and estimated with actual recipient; proposed ceiling0.00005 ETH.

Core conservative storage+configured fees .2196+Q<=.26579; actual Q<=.04619 and D=.02+Q<=.06619. Fresh mint .012+20T, possible separate minter refund70T. Slots3*.0032=.0096 included core. Secret gross .1+50T, actual net growth unknown pending refund. The scoped plan has NO private exits or exit admission deposits; cleanup of any actual minter credit may require70T. No guaranteed fee estimate is asserted. Use existing compute credit only, max33 jobs with3000microUSD cap each (<=.099 total); no top-up. Use<=.90 source USDC with delivered>=.80; keep collateral in the wallet after both A and B, with actual floor>=.50. L retains title; the real new-owner cooldown is not waived.
Net spend, gross debits, peak liquidity and retained collateral are different ledger columns. If .4 means every gross transfer/temporary attachment before refunds, STOP for explicit budget interpretation. Before lending ON reserve enough actual remaining budget for completion/OFF. Every tx<=.1 except approved secret merge; include gas at actual price.

## Governance/time
Loan/toggle/register paths do not touch staged upgrade or pending owner. Recheck unchanged after every native/worker-native tx. Separate apply eligible2026-11-12 14:34:17.027936 Africa/Cairo; accept eligible14:36:27.377191 Africa/Cairo. Apply must precede accept since accept clears staged upgrade. No overlap with live loans/unresolved jobs; finish and OFF before that separate maintenance. None of those governance calls belongs to this runbook.

## Remaining capability/evidence gaps
The code now implements/test-covers post-install audit/provenance, admin-role/liveness evidence and token-epoch phase locks. Remaining live evidence: actual A/B receipts, measured runtime provenance/reviews, private deposit/native cashouts/holder-only control reads, supported provider schema/route, and reviewed publication/doc gates. Current guardian signature is not proof of future liveness or a successful provider policy-edit operation. Native sale/royalties/old-owner refusal already have proof and must regress safely. General paid autonomous business revenue/job handover, per-target delegated-agent execution, inheritance, receivables/inspection, savings/passkeys/DAO membership, broad BTC/EVM/SOL execution are different products and are NOT added by this patch. Catalog route counts do not prove live routes. On-chain immutable governance, dynamic FX/LTV oracle, USDC-denominated debt, proportional default recovery/Dutch auction cannot be added by a worker-only patch. Whole wallet collateral default and fixed USD floor vs NEAR debt remain explicit economic assumptions. Browser37 checks and existing sale screenshots are not fresh-loan mobile/accessibility proof. Attestation verifier boundaries/source/hash/docs drift and current private route minima must be documented/tested, not fabricated as closed. Traded token k5f4750858f328940 remains ineligible for fresh provenance.

## Official references
https://skills.outlayer.ai/outlayer-cli/SKILL.md
https://skills.outlayer.ai/agent-custody/references/register-and-auth.md
https://skills.outlayer.ai/agent-custody/references/confidential.md
https://api.outlayer.ai/openapi.json
https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/confidential-swaps.md
https://developers.circle.com/stablecoins/usdc-contract-addresses
Cached schemas: OUTLAYER_PHASED_PROVISION_PUBLIC_SCHEMA.json and OUTLAYER_APPROVAL_AND_BASE_SCHEMA.json under /workspace/handoff.

## Implemented ordering correction
Official RequestType docs say the deposit family gates as call. Therefore the implemented fixed Base-USDC funding operation is PRE-INSTALL (after fresh creation/candidate review and before prepare/install), not after sealing. Do not add arbitrary call capability. Verify genuine deposit terminal credit before preparation inventory. This leaves up to0.90USDC temporarily held during subsequent installation/review; unknown or failed enrollment can remain locked and must be reported. No positive policy-update probe exists.

### Final implementation notes
The V2 companion is content-addressed at `t/<token>/collateral_enrollment_v2/proofs/<report_sha256>`; `confinement_v1.authority_audit_sha256` selects it. Marker is last; uncommitted expired reports can be refreshed without erasing prior evidence. Fresh creation reads/seals the actual full empty request/order/approval inventory and zero private balances, returning that noncredential inventory for team review. This includes terminal reusable-authority artifacts, not just pending jobs. Production dispatch checks the token-scoped latch even for existing value journals.

Funding correction: deposit-family requests are `call` policy operations. Therefore Base USDC funding must complete **before** confinement policy installation, not after it. The new fixed funding quote/status operations have one POST claim, canonical destination, >=800000 unit minimum for 900000 Base USDC, and strict actual quote/deadline/schema checks. If the documented intent_id cannot be polled at the documented request endpoint, STOP; do not try another funding POST or weaken policy.

Final operator envelope (not a live quote): <=.4 NEAR including >=.04 completion/OFF incident reserve; .90USDC source collateral + <=.099USDC reserved existing compute (<=33 jobs×.003) = <=.999USDC gross, and separately <=.00005 existing Base ETH for actual gas. Actual route output must be >=.80USDC. Exact candidate bytes change the FastFS fee from the earlier sample, so reprice from actual upload receipts. No top-up or external swap needed.

## Hard budget and receipt gates
The previous full-redemption configuration could reach ~.43NEAR at maximum Q and
all prepaid gas burned; that is NOT an approved bound. This scope removes the two
private exits, but actual Q/storage/secret retention/current gas and worst remaining
completion must still pass `node scripts/worker/pilot-budget.mjs "$E/budget.json"`
before publication, collateral funding, each value step and lending ON. Total FINAL
spent + unresolved max + remaining worst + >=.04 OFF reserve must be <=.4NEAR;
source<=.90USDC + <=.099 compute reservations <=.999USDC-equivalent;
actual recipient-specific Base execution+L1 fee <=.00005ETH. Only FINAL refunds
can reduce the ledger. Peak liquidity/internal capital transfers are separate.
Every original native hash/signature/action and all terminal descendants must be
checked; `scripts/worker/native-pilot-receipt.mjs` rejects non-FINAL, wrong identity,
failed/missing/duplicate/orphan/cyclic descendants. Exact native Transfer amount,
recipient, payout callback and resulting loan/control still need actual proof,
not a balance delta or top-level SuccessValue. The exact future commands and STOP
points are in LIVE_LOANS_EXEC.md (same as the local handoff copy).

The live identity is now promoted to v2.7 through a separate read-only evidence path: FINAL original deployment receipt, exact local release bytes, current pinned-block code/version/config and immutable minter/attestor/recovery. Public capture is docs/evidence/live-v2.7/promotion.public.json. No redeployment or governance action is involved. Production contract source/release files remain byte-identical, including historical deployed/v2.6 evidence; verifiers select the existing release/v2.7 bytes for current live identity. The worker candidate remains unpublished.

## PR208 correction and mandatory execution gates
- Canonical OUTLAYER_PAYMENT_KEY is securely supplied from nonce 2, the $20 grant. Scoped PAYMENT_KEY aliases authenticate both CLI run and original status polling. Key 1's $0.50 remains separate and untouched. API https://api.outlayer.ai; max 33 jobs, .003 each; no topup.
- Exact policy readback binds wallet_id to the reviewed manifest/candidate. The closed schema rejects unknown fields, wrong wallet, extra capabilities/keys and changed refunds. Absent/empty refund map explicitly means provider-derived defaults; null is refused. Usage counters may vary but are not authority. The same predicate protects report, finalize and frozen certificate observations.
- Malformed/empty RPC JSON and error envelopes are rpc_unavailable, never absence. Only a parsed literal null establishes fresh absence; wrong method-specific schemas fail before provider POSTs.
- Exact exit replaces the old universal stop only for the explicitly signed `exact-near-v1` plan. Its three documented endpoints use no guessed minimum/quote fields. Exact source debit/public self-credit gates precede registration and exact public withdrawal; FINAL FT/Intents balance deltas gate completion. Other routes and missing-ID replay remain denied. See EXACT_NEAR_EXIT.md; actual provider fill and causal receipt attribution are not proved by source tests.
- Current candidate validation is in docs/evidence/worker-provisioning/v2; historical R1-R4 measurements remain historical. No new live policy installation or loan is asserted. Credit: devmo.

## Provider addition required for any future public redemption
A typed immutable non-dry 1Click-quote-bound confidential same-USDC self-exit must
bind source wallet/verifier/asset, amount/max debit, current holder recipient,
canonical destination chain/asset, minimum NET after fees/registration, deadline,
nonce/epoch and exact quote ID/hash/commitment. The measured keystore must parse or
rebuild the actual signing artifact, enforce these fields and no extra authority,
and execute THAT quote without re-quote/unbound fallback. Preserve original request
IDs through UNKNOWN; expose actual destination tx/net amount/refund evidence.
Worker must verify terminal FINAL destination FT descendants and signed minimum;
shortfall/wrong destination/failed descendant is never success. Postchecks cannot
reverse a bad fill. Current API/provider coordinator trust is not cryptographic
artifact enforcement. No current endpoint is invented or enabled by this plan.
