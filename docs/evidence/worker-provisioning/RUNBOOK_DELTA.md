# Exact delta to WORKER_AND_LOANS_RUNBOOK.md

This is a future execution plan, not authorization or a record of mainnet actions.

## Replace publication preparation

Use checkout `R=/workspace/near_hackathon/wt_worker_prov` and the hash/byte length in [candidate.json](candidate.json), not the historical checkout or `59379cfe`. Build twice and require byte identity and exact-head independent review. Add the separately approved reviewer public key to the existing default enclave secrets as `COLLATERAL_AUDITOR_PUBLIC_KEY` (base64 32-byte Ed25519 public key, not a private key). This key is **not** the immutable loan-certificate attestor; no migration/minter/attestor replacement occurs.

Follow the **six-native-transaction** batched plan (two upload chunks, one secret merge, three registry batches) in [RESEARCH.md](RESEARCH.md) and [publish-plan.json](publish-plan.json). The publication snapshot has 22 old versions. Refresh it, maintenance/drain approvals and native balances before signing. One new active registration plus removal of exactly those 22 leaves count 1. Preserve project ID, UUID and nonce-1 payment-owner storage. `GUARDED_WORKER_HASH` must be the new candidate hash. The official CLI secret merge's 0.1 attachment is refundable excess/storage, not a burned fee; it still needs native capital and any applicable all-in transaction-ceiling approval. Never run any NEAR payment-key top-up.

## Replace every HTTPS compute flag

`--compute-limit 1000000000` → **40000 for the first info call, 10000 thereafter**. In CLI HTTPS mode this is microUSD, not instruction count. Keep `--async`, exact `--version`, existing payment owner nonce 1, `--secrets-profile default --secrets-account keyhole-devmo.near`; no developer `--deposit`. At most 20 paid calls in total, aggregate authorization ≤$0.23. Poll existing call IDs using GET, never resubmit a pending call. No top-up now.

## Replace the missing provisioning step (§4 and setup step 3)

All following parameters are inside a fresh holder's NEP-413 signed request, same as normal worker operations. These operations are intentionally **direct worker operations**, not additions to the public web gateway allowlist. Sessions and EIP-191 cannot authorize provisioning. The caller supplies no wallet key, arbitrary policy, arbitrary ciphertext or minter signer.

1. Fresh dedicated token, verified team holder and `owner_epoch`; minter payout slot registered; canonical wallet established with normal `account`. Never use a previous holder alias.
2. `prepare_collateral` params:
   ```json
   {"token_id":"ACTUAL_TOKEN","owner_epoch":"ACTUAL_EPOCH","approvers":[{"id":"ACTUAL_REACHABLE_REVIEWER.near"}],"threshold":1}
   ```
   It requires the separately released contract CAS protocol 2, no binding/provider policy and zero loan/value/listing/transfer/registration locks. Preparation claims are epoch-scoped; an unsent old-epoch plan cannot strand a later holder. It constructs the restricted policy, locks new custody sends locally, calls provider encryption/signing inside the enclave, verifies the exact wallet/caller/locked/version/expiry signature, and seals the plan. Return `provision_id`, wallet/ciphertext/plaintext hashes and expiry; never return the reusable signature/API key. A lost POST is UNKNOWN, not permission to create another plan. It does not register anything on chain.
3. `collateral_quote` params `{token_id,owner_epoch,provision_id}` returns real `provider_quote_yocto=Q`, exact `binding_deposit_yocto=0.02+Q`, beneficiary and ciphertext byte length, using the actual sealed artifact. Preserve output attestation/finalized observations. Public size probes are not this quote.
4. Independent reviewer audits actual full authority history and effective policy, including reachable quorum, aliases, old jobs and presigned/external-chain/MPC authority. Retain a real report with digest `authority_audit_sha256`. The configured reviewer signs exact UTF-8 bytes `KEYHOLE_COLLATERAL_AUDIT_V1\n{audit_message}` with Ed25519. The JSON message has exactly the `AuthorityAudit` schema in [collateral.rs](../../../tee/worker/src/collateral.rs), domain `KEYHOLE_COLLATERAL_AUDIT_V1`, project UUID, keys contract, `provision_id`, report digest, issued/expiry unix seconds (at most 900 seconds), and all six independently verified authority/policy/quorum declarations true. A digest or a holder's Boolean alone authorizes nothing. No fixture report/key is accepted in production.
5. `provision_collateral` params:
   ```json
   {"token_id":"ACTUAL_TOKEN","owner_epoch":"ACTUAL_EPOCH","provision_id":"ACTUAL_PREPARATION_ID","audit_message":"EXACT_REVIEWED_JSON_STRING","audit_signature":"BASE64_REVIEWER_SIGNATURE","max_deposit_yocto":"ACTUAL_APPROVED_D"}
   ```
   Verify audit signature against the pinned enclave public key, exact plan/owner epoch/build, current inventory and absence of policy/binding. Requote Q with minter beneficiary and enforce signed maximum D, native storage backing, gas/reserve and transaction ceiling. Every native minter path atomically acquires the append-only global send generation **before** nonce lookup/signing. The existing enclave-only minter signs `register_collateral` with **200 Tgas and exactly D**, including required `expected_owner_id` and `expected_owner_epoch` arguments, which the contract checks atomically. The chain reservation blocks title, value, sale and loan changes until the original store/read is terminal; a lost callback stays locked. Persist the exact original transaction hash before broadcast. Never auto-cashout, refund, retry binding, call `check_collateral`, replace an UNKNOWN send, or obtain the minter private key.
6. If not immediately terminal, `reconcile_collateral` params `{token_id,owner_epoch,provision_id}` only GETs the original native transaction and reads current chain/provider inventory. Exact original transaction/actions/arguments/deposit, `FINAL`, terminal Boolean true, terminal receipt lineage, pending registration absent, binding ready, controller, locked policy/version/ciphertext hash and canonical wallet must all match. The decrypted effective `/wallet/v1/policy` must also equal the prepared restricted policy, capabilities and authorized keys. Only then the reviewed writer seals `t/<token>/confinement_v1`, once; conflicting writes fail. This is the row consumed by existing `loan_certificate`.
7. A real terminal failed registration releases only the minter nonce latch and reports `FAILED_LOCKED`; it does not create eligibility or retry. UNKNOWN keeps all relevant locks. A genuine fresh-authenticated current holder can reconcile an already-installed original plan using signed `provision_owner_epoch` (the preparation epoch) alongside current `owner_epoch`; that never authorizes a second install. A→B→A cannot submit an old plan. Lost/UNKNOWN preparation needs reviewed recovery, not a guessed reset. `reconcile_minter_send` GETs the original global generation; only its original actor or project owner may fence `abort_unsent` by winning the atomic never-dispatched decision. Once dispatch is claimed, no timeout/error string can clear or rebroadcast it. Release gates are in SECURITY.md.

## Replace exit-quote workaround (§5 setup step 5)

Use holder-authenticated `withdraw_dry_run` params `{token_id,owner_epoch,chain:"near",token:USDC,amount:"100000",to:CURRENT_HOLDER}`. It is a provider preview without signing/broadcasting a withdrawal or spending admission/budget. Require positive output/minimum, actual route deadline and receiver-specific fees/registration deduction; separately prove cooldown and approval executability. It does not accept a lender's address as an ordinary holder self-exit. Quote L again once L really becomes the holder after default.

## Keep unchanged

Keep lending disabled until every live policy/authority/route/attestation gate passes. A repay, debt-on-native-delivery, B related-party default, exact epochs, holder-only ordinary exits, lower freeze/thaw, pull payouts, nonce-bound reconciliation and UNKNOWN semantics are unchanged. Never call `new()` or legacy `migrate()` on the live account; the already-completed `migrate_pledge` is not repeated. The 13-FINAL-transaction funded acceptance remains a separate existing proof and is not relabelled as this pilot.

## Release checklist

The source blockers are implemented with a separately labelled v2.6 CAS contract candidate. That candidate is not deployed; the worker refuses provisioning unless `collateral_registration_protocol()` returns 2. Use the release checklist and trust boundaries in [SECURITY.md](../../../SECURITY.md). Candidate identity remains separate from live identity.

## Maintenance and interruption recovery

**Planned downtime, not an atomic or zero-downtime cutover.** No production change was performed. The old five-transaction estimate was for the smaller R1 worker; R2 crosses the official 1-MiB chunk boundary, so its worker publication requires **six** native transactions. A separately approved/reproduced v2.6 code-only contract deployment is additional and must precede provisioning. Lending stays disabled throughout and after reopening ordinary service. Preserve `migrate_pledge` state; never call `new()`/legacy `migrate()` or repeat the completed migration.

### Barrier and durable handoff (before any signing)

1. Obtain the owner's separate approval for this exact candidate, active/retired snapshot, reviewer public key, gross secret escrow and all-in costs. Deploy/verify the CAS contract only under its separate release approval. Check protocol 2, unchanged minter/attestor/config and no unresolved legacy callbacks.
2. Enable `KEYHOLE_MAINTENANCE=1` on the gateway release containing the [first-in-handler barrier](../../../web/app/api/worker/route.ts). Exercise both `/api/worker` and its `/api/keyhole` alias: harmless info, signed operations and invalid JSON must return 503/no-store with **zero** upstream calls, including cached results. [Executable test](../../../web/tests/workerMaintenance.test.ts). This environment change/rollout is future work requiring approval, not something this local task applied.
3. Explicitly pause every direct CLI, routine, payment-key submitter and version-pinned caller; the HTTP barrier is not a provider-wide switch. Drain/reconcile every already-dispatched old job, provider authority and native send. A missing original or UNKNOWN means STOP. Record a persistent operator handoff journal: candidate hash/bytes, project UUID, previous active hash, exact retired list, secret **public hash/version only**, fixed upload batch nonce, payload digests, and each original native signed hash/status. Store no private key/decrypted secrets in that journal. Obtain maintenance acknowledgement from every submitter before proceeding.
4. Keep maintenance ON across crashes/reboots/handoffs. Only one operator signs. Native CLI templates are now **save-to-file, then send**; journal the verified original hash before using their separate `send_command`. Never overwrite an existing signed file. The official secret-merge CLI has a distinct lost-response procedure below. Read-only status polls are safe. Never rerun an entire CLI publication after an interruption, and never resend an UNKNOWN action. If a fully signed original exists, resolve that original; absence from one RPC is not proof it was never submitted. A genuinely never-signed step may be signed once after refreshing its context. The [read-only recovery classifier](../../../scripts/pledge/cutover-recovery.mjs) and four regressions cover every registry milestone, missing barriers, UNKNOWN, namespace mismatch and restore gates; it does not execute transactions or replace receipt proof.

### Exact resume table

| Interruption point | Establish using original evidence | Only permitted next step (maintenance remains ON) |
|---|---|---|
| Before upload chunk 1 | Old active/hash set unchanged, all submitters paused/drained | Generate fixed-nonce payloads once; sign chunk 1 only if never signed |
| During/after chunk 1 | Original FINAL indexed transaction has exact chunk-1 Borsh bytes; gas=1 execution failure is expected; digest and batch nonce match saved plan | Resolve UNKNOWN original by hash. When chunk 1 is proved indexed, submit only the never-signed chunk 2 from the saved plan, same nonce |
| During/after chunk 2 | Both original payloads indexed; assembled FastFS GET bytes/hash/length exactly candidate | Resolve original; never start a fresh batch. Then secret merge, only if not previously submitted |
| During/after secret merge | Exact original FINAL successful secret update; public hash/version and access unchanged except approved additions; check actual S/refunds without exposing plaintext | If old registry remains intact and merge proved applied, registry batch 1 only. UNKNOWN/mismatch: stay closed and investigate; no blind second merge |
| During/after registry batch 1 | Original batch is atomically FINAL/successful with all receipts/refunds; exact set = candidate + old indices 4..21 (19 versions); active candidate | Registry batch 2 only: retire indices 4..12. Guarded calls deliberately refuse at count 19 |
| During/after registry batch 2 | Exact original FINAL and set = candidate + old indices 13..21 (10 versions); active candidate | Registry batch 3 only: retire indices 13..21. Guarded calls deliberately refuse at count 10 |
| During/after registry batch 3 | Exact original FINAL, all removal/refund outcomes, registry count exactly 1 and active hash/URL/UUID correct | Restore-service checks below; do not assume info means service is usable |
| After checks / while reopening | Complete successful restore evidence and maintenance handoff journal | Separately approve removing maintenance and resuming compatible submitters once; any missing gate keeps 503 |

A definite **failed atomic registry batch** leaves its prior milestone intact; investigate the original failure and refresh funding/limits before a separately approved new attempt. Unexpected sets/active hashes, partial receipt evidence or any UNKNOWN are not permission to split, skip or reissue a batch. Each transaction is atomic only within its own actions; the three registry transactions are not collectively atomic. At count 19/10 the live public gateway is deliberately **unavailable (503)**, not exposed as an apparently healthy broken worker. No rollback to a retired/unsafe old build. If recovery cannot be proved, keep maintenance and provide an operator incident handoff rather than reopening or improvising a hash switch.

### Fixed upload payload preparation (offline, unsigned)

```bash
# Pick and record FIXED_U32_BATCH_NONCE once; OUTPUT_DIR must not exist.
node scripts/pledge/fastfs-payloads.mjs   tee/worker/target/wasm32-wasip2/release/keyhole-worker.wasm   "$OUTPUT_DIR" "$FIXED_U32_BATCH_NONCE"
```

The resulting `upload-plan.json` contains **unsigned** per-chunk save-before-send templates using raw `file-args`, 1 gas and zero deposit. Each refuses an existing signed file; its separate `send_command` is allowed only after journalling the original hash. No command is executed by the generator. Archive payload digests and original hashes; retain the small local files until assembly is proved. Do not rerun the official uploader after a partial upload: its fresh nonce is not a continuation. Public wire/parser sources and costs: [RESEARCH.md](RESEARCH.md#upload-wire-format-and-interrupted-chunk-recovery-sources).

### Restore-service gate (all required)

- Exactly one registered version, candidate active, original UUID/payment-owner namespace and matching public FastFS bytes.
- `GUARDED_WORKER_HASH` equals candidate; genuine runtime attestation measures those bytes and original enclave minter and immutable certificate attestor persist. `info` is necessary but **not sufficient**.
- A harmless **fresh-holder guarded read** (for example the canonical-wallet account read) succeeds through the one-version registry gate; no financial operation, fake audit or loan is used as a smoke test. It consumes a slot in the approved 20-call/$0.23 ledger, including failures.
- Deployed frontend/CLI is compatible with current live contract/epoch/payout rules; borrower and lender write flags plus contract lending remain OFF. Check both gateway aliases while maintenance is still enabled.
- Promote live identity only from real finalized deployment/publication evidence through separately reviewed release tooling, never from this candidate or a hand-edited hash. The currently shipped live-promotion capture is v2.5-specific; future v2.6 release tooling is a separate reviewed gate. Check health as a passive observation, not a paid retry loop. Record separate approval to lift the barrier and resume every paused submitter.

Trust limits and real-input prerequisites: [SECURITY.md](../../../SECURITY.md#r2-provisioning-repair-and-cutover-boundary).

### Native presign journal and lost secret-merge response

For each upload chunk and registry batch, use a private operator journal directory outside the repository with `umask 077`. The generated `command` saves the signed transaction to a new `STEP.signed.json` and does **not** broadcast; its `send_command` is separate. Before sending:

```bash
node scripts/pledge/signed-hash.mjs "$STEP_SIGNED_JSON" > "$STEP_HASH_FILE"
# Retain/fsync the signed file, public hash, exact unsigned plan and handoff record.
# Only then use that step's separately approved send_command, once.
```

The [offline original-hash verifier](../../../scripts/pledge/signed-hash.mjs) validates the saved V0 owner/Ed25519 signature and computes the canonical native hash without looking up a key, signing, printing payloads or networking. Its three regressions include altered bytes/signatures, owner/key/version rejection and malformed files. Unsupported formats STOP, rather than guessing a hash. [Official NEAR CLI save-to-file](https://github.com/near/near-cli-rs/blob/master/src/transaction_signature_options/save_to_file/mod.rs) preserves the base64 signed transaction; [send-signed-transaction](https://github.com/near/near-cli-rs/blob/master/src/commands/transaction/send_signed_transaction/mod.rs) consumes that saved file. Do not prepare all registry transactions with the same nonce: sign the next only after the preceding original is terminal.

**The official v0.2.2 secret updater signs and broadcasts internally**, unlike these native CLI templates ([NearSigner source](https://github.com/out-layer/outlayer-cli/blob/v0.2.2/src/near.rs)). Do not pretend it has a presign/resume flag. Before its one invocation, under the existing barrier/drain, journal the owner signing public key, its finalized nonce and final block height/hash; permit no other use of that owner key. Prefer a separately reviewed signer integration that durably records `signed_transaction.get_hash()` before broadcast. If the unmodified CLI loses its response/hash, do **not** rerun it: recover the original using read-only archival `block`/`chunk` queries from the recorded block (or an independently checked indexer), match the sole owner/public-key/next-nonce transaction to `outlayer.near`, method/gas/deposit, then GET that hash to FINAL and verify the encrypted row's actual arguments/metadata and refunds. [NEAR RPC block/chunk documentation](https://docs.near.org/api/rpc/block-chunk). Save that original hash in the handoff journal before proceeding. Scan at most 300 finalized blocks per recovery pass, with a persisted cursor and provider-rate-aware read budget; a longer interval needs operator-reviewed continuation, not a money retry. Zero matches, inconsistent context, multiple matches, missing history or UNKNOWN keep maintenance ON and require incident handoff. Absence from a scan is never proof it was not submitted. When the exact original is established, resume at registry batch 1, not secret merge. This preserves a recovery route for every step without fabricating automatic recovery from an unknowable outcome.


## Exact v2.5 → v2.6 contract upgrade and migration needs

A **plain code redeploy on the same `keyhole-devmo.near` account is enough**. No state migration is required. Do not call `new`, legacy `migrate`, or `migrate_pledge`. The finalized [live six-NFT/configuration snapshot](r2/live-upgrade-before.json) reports v2.5, six NFTs and an already-initialized Pledge configuration. Preserve its exact recovery account, attestor public key, custody account and network; no reinitialization or key replacement is involved. The serialized `Contract` fields/order and existing collection prefixes/row layouts are unchanged. New nonce-terminal markers use the separate lazy `Pr26t` map; they need no state rewrite. Drain/reconcile existing pending work under maintenance before the separately approved code deployment.

The [real-runtime code-only regression](../../../contracts/keys-sandbox/tests/upgrade.rs) deploys the exact v2.5 release with all six recorded NFT IDs, owners and metadata, then performs only DeployContract to v2.6. It compares every NFT/approval map, owner, tier, holder enumeration, global configuration/metadata, Pledge configuration, minter credit and control/epoch state. It also covers an uninitialized fixture: code deployment does not silently initialize Pledge. For a different deployment whose config is null, the separate one-time self-call `migrate_pledge(recovery_account, attestor_public_key, custody_contract, network)` would initialize isolated Pledge metadata with lending disabled; that is **not needed and must not be repeated on this live account**. Nothing here deploys code or changes the six live NFTs or owners.

Primary platform source: [NEAR Updating Contracts](https://docs.near.org/smart-contracts/release/upgrade) documents that account code and storage are separate, state persists on code redeploy, and migration is needed when stored structures change. Here the serialized `Contract` block is byte-for-byte unchanged from integrated main v2.5, and the runtime preservation regression directly exercises the upgrade.
