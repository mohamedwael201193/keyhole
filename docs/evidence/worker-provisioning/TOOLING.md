# v2.6 code-only promotion and phased release checks

These are future commands, **not authorization**. None was executed with financial evidence. Default dry-run uses public finalized views only. [R4 result](R4.md) · [trust boundaries](../../../SECURITY.md#r3-promotion-and-execution-evidence-boundary).

## Commands and interruption handoff

```bash
# Safe now: new output file, no signing, broadcast or paid compute.
node scripts/release/promote-v26.mjs --dry-run --out "$PUBLIC/before.json"
# Future approved operator only. Evidence/trust are reviewed files outside Git.
node scripts/release/promote-v26.mjs --check-gates --phase predeploy --before "$PUBLIC/before.json" --evidence "$PUBLIC/evidence.json" --trust "$PUBLIC/trust.json" --out "$PUBLIC/predeploy.checkpoint.json"
# A separately authorized wallet supplies the saved DeployContract signature.
# This program cannot create it. Only one operator and one durable journal.
node scripts/release/promote-v26.mjs --execute --before "$PUBLIC/before.json" --signed "$PRIVATE/deploy.signed.json" --approval "$PUBLIC/native-approval.json" --evidence "$PUBLIC/evidence.json" --trust "$PUBLIC/trust.json" --journal "$PRIVATE/deploy.wal.json"
# Also use this after response loss: ORIGINAL_HASH only; never dispatch again.
node scripts/release/promote-v26.mjs --post --before "$PUBLIC/before.json" --hash "$ORIGINAL_HASH" --out "$PUBLIC/post.json"
node scripts/gen-identity.mjs --promote-v26 "$PUBLIC/post.json"
# After all six separately approved worker-admin transactions:
node scripts/release/promote-v26.mjs --check-gates --phase deploy-post --evidence "$PUBLIC/evidence.json" --trust "$PUBLIC/trust.json" --out "$PUBLIC/deploy-post.checkpoint.json"
node scripts/release/promote-v26.mjs --check-gates --phase restore --evidence "$PUBLIC/evidence.json" --trust "$PUBLIC/trust.json" --out "$PUBLIC/restore.checkpoint.json"
node scripts/gen-identity.mjs --promote-worker-v26 "$PUBLIC/evidence.json" --release-trust "$PUBLIC/trust.json"
# Provisioning and actual loan-freeze gates are deliberately separate phases.
node scripts/release/promote-v26.mjs --check-gates --phase provision-pre --evidence "$PUBLIC/evidence.json" --trust "$PUBLIC/trust.json" --out "$PUBLIC/provision-pre.checkpoint.json"
# Only AFTER original install/reconciliation, BEFORE opening the loan:
node scripts/release/promote-v26.mjs --check-gates --phase provision-post --evidence "$PUBLIC/evidence.json" --trust "$PUBLIC/trust.json" --out "$PUBLIC/provision-post.checkpoint.json"
node scripts/release/promote-v26.mjs --check-gates --phase pilot-post --evidence "$PUBLIC/evidence.json" --trust "$PUBLIC/trust.json"
node scripts/gen-identity.mjs --worker-candidate --contract-candidate
node scripts/gen-identity.mjs --check
bash judge/1-contract.sh --strict
bash judge/0-live.sh
python3 judge/gen-claims.py .
node judge/verify-claims.mjs --strict
```

Run the post-check before any mint/provision/loan or config change: it compares **all raw state rows** plus exactly six complete NFTs/owners, controls/epochs, every current-owner/minter/treasury/recovery credit and pending payout, metadata and configs. It re-fetches both pinned canonical finalized snapshots and the original closed FINAL deploy graph; receipt blocks must lie within the capture interval. One self-account DeployContract with reviewed bytes only; no function call. Historical migration hash survives promotion. Sources/layout are unchanged; no state migration. The existing rollback path and exact roll-forward table are in [RUNBOOK_DELTA.md](RUNBOOK_DELTA.md).

A journal written before broadcast is deliberately UNKNOWN even if the process crashes before networking. Its existence blocks a second dispatch. A definite failed original needs new human review, not a new journal as a retry workaround. Keep maintenance ON for any missing preservation proof, original receipt, authority drain or intermediate registry state. Post-check/promotion are reads and local generation only; never repeat migration or automatically roll back.

## Evidence/trust schema (public commitments, never secrets)

`trust.json` contains base64 32-byte **public** `release_public_key`, independently enrolled `auditor_public_key`, and the complete reviewed `direct_submitters:[{id,public_key}]`. Test-fixture keys are not enrollable production evidence. Trust enrollment/report review is a separate human authorization; a caller cannot self-enroll by passing a convenient key. Keep real saved signatures private/off Git. Never export the sealed Prepared record, reusable wallet signature, minter/custody key or decrypted secret profile.

Each attested row is `{call_id,input,output}` from the actual original call. The checker GETs the public attestation, binds canonical input/output SHA256, exact project and registered/executed worker hash, quote/measurement and freshness. Supply `prepare`, `quote`, `install` (original provision call, possibly UNKNOWN), `provision` (genuine successful original reconciliation), `restore` (`withdraw_dry_run` only), `inventory` (`pledge_inventory`), `info`, and—only pilot-post—`certificate`. The prepared artifact stays sealed; public output fields are `provision_id,wallet_pubkey,token_id,owner_epoch,policy_hash,plaintext_hash,version,valid_until,authority_review_required`. No caller-manufactured provider policy is accepted.

`audit` contains `provision_id,audit_message,audit_signature,report`. Exact AuthorityAudit JSON has 13 fields from the Rust schema, all six declarations true, actual sanitized report digest and lifetime at most900 seconds. Signature bytes are `KEYHOLE_COLLATERAL_AUDIT_V1\n` followed by exact original JSON. The successful measured installation/reconciliation must bind that same trusted review; UNKNOWN alone cannot seal eligibility.

Each owner approval is `{payload,signature}` over `KEYHOLE_RELEASE_APPROVAL_V1\n` plus recursively sorted JSON payload. Every payload includes `action,account,contract_sha256,worker_sha256,expires_at` (fresh, within900 seconds). Additional fields:

| Evidence field / action | Required approved payload fields |
|---|---|
| `maintenance` / `maintenance-and-drain` | `gateway_aliases:["/api/keyhole","/api/worker"]`, complete `direct_submitters` IDs, `old_jobs:0,unknown_native:0,unknown_provider:0`, `barrier_sha256` of canonical actual `barrier_observation` |
| `approval` / `deploy-code-only-v26` | exact canonical `before_state_sha256`, reviewed `protocol_config_sha256`, `public_key` and decimal `nonce`, decimal `max_storage_yocto,max_gas_yocto,max_all_in_yocto`; budget at least1405 bytes × storage price plus300 Tgas × fresh gas price, backed after user liabilities |
| `pilot_approval` / `pilot-budget` | decimal `max_binding_yocto`, positive integer `max_calls<=20,max_micro_usd<=230000`, exact approved `subject` below |
| `publication_approval` / `worker-publication` | `registry_before_sha256`, `secret_args_sha256`, decimal `previous_secret_deposit_yocto,max_secret_storage_yocto,expected_secret_refund_yocto` |

`pause_acknowledgements:[{id,signature}]` must cover every trusted direct submitter. Each signs `KEYHOLE_PAUSE_V1\n` plus SHA256 of canonical maintenance payload. Fresh 503/no-store checks are collected from both fixed gateway aliases with invalid JSON (cannot submit compute); live checks must equal the separately signed `barrier_observation` digest. `--observe --out NEW_FILE` collects that read-only observation for review before signing; it implies no approval. Historical checkpoints retain the signed observation instead of pretending a fresh HTTP response proves past maintenance. That off-chain fact remains the enrolled reviewer/submitters’ assertion, while original chain/attestation facts are re-fetched. Actual inventory/drain and undeclared-authority review remain human attestations, not provider-global cancellation.

`compute_ledger:[{call_id,op,limit_micro_usd,status}]` has unique original IDs, includes failures/UNKNOWN and every supplied measured row, at most20 calls and230000 microUSD. First info allowance at most40000, every later call at most10000. The collector checks the actual nonce1 payment-owner balance/reservations; never a NEAR key top-up. Quote Q is checked against actual attested ciphertext length `(bytes+523)*10^19`, D=Q+0.02 NEAR, approved max D, deposit and minter beneficiary; current minter storage/reserve is independently read. This reserve/Q gate is **provision-pre**, with no binding yet: it never requires a future successful installation or loan. The original pre-transaction checkpoint is revalidated later; it is not charged twice.

`secret_merge:{hash}` names the actual original FINAL `store_secrets` transaction. The collector reads current metadata/ciphertext digest and every original receipt body; no plaintext is exposed. Exact slot is `{Project:{project_id:"keyhole-devmo.near/keyhole"}}`, profile default, owner from transaction signer (there is no store owner argument). Actual S and original storage-refund transfer must match approved arithmetic and current ciphertext/access; gas refunds are not mislabelled storage refunds.

`publication:{before_block,hashes:[BATCH1,BATCH2,BATCH3]}` names actual original registry batches. Fresh canonical before capture must match the reviewed22-version/previous-active/UUID snapshot and signed digest. Exact5/9/9 actions, one add of reviewed source bytes/URL and22 unique removals, FINAL closed graphs and receipt block intervals are checked. Current registry must be singleton; actual FastFS bytes/hash/length and measured info/minter/immutable attestor must match. Code must already be v2.6 and lending still OFF. The generator never labels unpublished candidates live.

`freeze:{hash,signer_id,token_id}` is the original `open_loan`, not a made-up freeze method. The collector independently fetches its graph/receipt actions, current loan/binding/policy and certificate template. Exact lower freeze wallet, callback nonce/generation, Offered/nonbusy state, frozen policy and immutable-attestor Borsh signature must agree. A freeze is pilot-post, never a prerequisite for deploying code or restoring disabled-lending ordinary service.

## Explicit phases and original checkpoints

`--check-gates` defaults to **predeploy**, not cumulative all. Each selected phase emits PASS/FAIL and `all_mainnet_gates=false` until a genuine pilot-post. Missing future evidence is **not evaluated**, not manufactured as PASS. `--phase all` is a retrospective audit of original checkpoints plus the current pilot, never a prerequisite to deploy or cut over.

| Phase | Evaluated now | Required original predecessor |
|---|---|---|
| `predeploy` | actual 503/no-store + complete signed pause/drain; exact native approval/protocol/budget and v2.5 six-NFT capture | none; no future quote, binding, publication, secret refund or freeze |
| `deploy-post` | original FINAL DeployContract only; exact v2.6 bytes and all six NFTs/owners/epochs/raw rows/credits/config preserved | `contract_post` from the original `--post` output |
| `restore` | singleton registry; actual secret/refund; measured info and positive guarded holder preview/exit; maintenance still ON, lending OFF; full three-batch publication collector | `checkpoints["deploy-post"]` |
| `provision-pre` | current holder's sealed preparation commitment, independent audit/quorum, actual Q, backed D/reserve and bounded compute ledger, complete idle inventory | `checkpoints.restore`; ordinary smoke role, which may intentionally be another token |
| `provision-post` | original measured install/reconcile success and sealed eligibility; exact actual lower policy/binding; **same pilot**, idle current control, fresh guarded self-exit/inventory | `checkpoints["provision-pre"]`; approved pilot role |
| `pilot-post` | actual **Offered / pledged=true** pilot, original open_loan/freeze/callback graph, exact approved subject/terms/nonce and live immutable-attestor certificate | `checkpoints["provision-post"]`; re-read original idle block, never preview a currently pledged token |

After each successful phase, `--out NEW_FILE` saves an exclusive evidence checkpoint. Insert that complete JSON under the indicated `checkpoints` key in the next packet; a filename, Boolean or PASS report is insufficient. Checkpoints contain schema, phase, exact release hashes, canonical finalized block, full-state digest and original evidence. The collector independently re-fetches that block by height/hash, all snapshot views/raw rows, the original measured input/output commitments and prerequisite proofs, with freshness evaluated **at the original block**. Later phase block order, approved token/holder/epoch/policy and expected loan nonce must agree. Keep real evidence/authorizations outside Git. Synthetic test fixtures are never eligible execution evidence.

The signed `pilot_approval.payload.subject` is exactly `{contract,network,token_id,owner,owner_epoch,wallet_pubkey,policy_hash,policy_version,provision_id,loan_nonce,terms}`. `terms` is the complete exact on-chain LoanTerms object; nonce is the expected `next_loan_nonce+1` before opening and the actual nonce afterwards. Each pilot checkpoint carries the same approval subject. A changed owner/epoch, unrelated independent valid certificate/wallet/policy, different terms, nonce or release cannot satisfy it. A separately identified ordinary smoke checkpoint never substitutes for the approved pilot’s pre-loan checkpoint.

Certificate input is the real public shape `{op:"loan_certificate",params:{token_id,loan_nonce}}`, exactly two params. The certificate Borsh schema does **not** sign a block hash. Its signed `observed_at_ns` is finalized-chain time truncated to milliseconds. The collector resolves it within at most64 canonical finalized blocks to **one unique** observed block, verifies the packet's `certificate.block` (hash/height/timestamp) equals it, compares the exact on-chain template and loan/binding/control both there and now, and bounds the original freeze receipts between the idle checkpoint and that block. Supply that original header in `certificate.block`; never invent it. Unresolvable/ambiguous/stale observations fail closed. At pilot-post the certificate must still be unexpired; a historical idle route deadline proves its original phase only, not a new executable exit while collateral is pledged.

Only after provision-post PASS may a separately approved operator enable lending for the bounded pilot and submit its original open_loan; pilot-post is evaluated afterwards, before any separately approved funding. Production web write flags can remain OFF for this direct-operator pilot. This document authorizes none of those actions.

Missing execution-only data remains FAIL, labelled **satisfied at execution time, verified by the post-check**. Source tests are not real readiness. Actual mainnet release inputs remain absent; see SECURITY. Keep production write flags OFF until separately approved pilot execution.
