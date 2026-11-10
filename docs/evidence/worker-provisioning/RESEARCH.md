# Read-only publication, storage and pilot budget research

No mainnet transaction, wallet registration, paid enclave call, policy signature, top-up or credential access was performed. Public evidence is [public-pricing.json](public-pricing.json). All human-readable times here are Africa/Cairo. The snapshot is at 20:14:55 Africa/Cairo. Nonce 1 remains $0.514657 available, $0 reserved; last usage 19:31:11 Africa/Cairo.

## Storage is reserved capital, not a burned publication fee

Authoritative public provider source is pinned to [`3ace18763b1a9cfa35f64cdcdd169287d01e68d4`](https://github.com/fastnear/near-outlayer/tree/3ace18763b1a9cfa35f64cdcdd169287d01e68d4).

1. [`projects.rs:add_version`](https://github.com/fastnear/near-outlayer/blob/3ace18763b1a9cfa35f64cdcdd169287d01e68d4/contract/src/projects.rs#L143-L222) retains only its calculated storage deposit and transfers excess back to the owner. `calculate_version_storage_size` is `150 + URL_bytes + hash_bytes + target_bytes + 64 + 8 + 16`. For this 64-hex FastFS URL and `wasm32-wasip2`, **440 bytes = 0.0044 NEAR**. The official CLI attaches 0.1, so **0.0956** is an automatic excess refund, not a fee.
2. [`secrets.rs`](https://github.com/fastnear/near-outlayer/blob/3ace18763b1a9cfa35f64cdcdd169287d01e68d4/contract/src/secrets.rs) combines an existing row's deposit with the new attachment, retains the new storage requirement **S**, and transfers excess back. The current row holds **0.01091 NEAR**. A CLI 0.1 update therefore refunds **0.11091 − S NEAR**, provided that covers S. Its permanent net storage change is **S − 0.01091**, not 0.1. Exact S requires the actual newly encrypted merged row and the `estimate_storage_cost` view with unchanged access and explicit `vault_id:null`.
3. [`remove_version`](https://github.com/fastnear/near-outlayer/blob/3ace18763b1a9cfa35f64cdcdd169287d01e68d4/contract/src/projects.rs#L278-L320) transfers that version's **recorded storage_deposit** to the project owner. It refuses the active version. Set the candidate active first; removing all 22 old registrations leaves exactly one callable registered version. Deactivation alone does not retire a callable version. Removal does not cancel queued jobs or revoke prior signatures.
4. Secrets storage can be released by a smaller replacement row or, after all obligations end, `delete_secrets`. Never delete the project or the active secret row while custody remains. Removing versions does not delete the shared project namespace. See [Projects](https://app.outlayer.ai/docs/projects), [Secrets](https://app.outlayer.ai/docs/secrets), and [NEAR storage staking](https://docs.near.org/protocol/storage/storage-staking).

All 22 captured old sources yield 440 bytes under the current formula: **0.0968 NEAR expected release**, subject to their actually recorded deposits. Version views do not expose historical deposits. Validate each real transfer receipt before booking a refund; do not assume a formula proves a historical on-chain amount. Native gas is separately consumed; NEAR staking release alone does not make a refund transfer unless the contract implements one, as this source does.

## Cheapest verified publication sequence at official gas allocations

The R2 candidate is 1,085,333 bytes. The official FastFS uploader chunks at 1,048,576 bytes: **two upload transactions**, not one. The generated candidate identity and publication plan are authoritative. Preserve UUID `p000000000000004b` and payment owner `keyhole-devmo.near`, nonce 1.

After exact-head independent review, full old-job/authority drain and a no-call maintenance window:

1. Prepare the two unsigned fixed-batch-nonce FastFS payloads with [fastfs-payloads.mjs](../../../scripts/pledge/fastfs-payloads.mjs), then save each signed transaction before sending and approve/send each separately with the verified original-hash journal. Verify both original indexed transaction payloads and the assembled public bytes against the generated candidate hash. No deposit; native action/byte fees still apply. The intentional gas=1 execution failure is expected by the indexer, not by itself an upload/indexing proof. The official `outlayer upload` is equivalent for an uninterrupted upload but has no resume flag; do not restart it after a partial/UNKNOWN upload. See [interruption recovery](RUNBOOK_DELTA.md#maintenance-and-interruption-recovery).
2. One official `outlayer secrets update` merging only `GUARDED_WORKER_HASH` and the independently approved public `COLLATERAL_AUDITOR_PUBLIC_KEY`; preserve every existing value and access rule. CLI attaches 0.1 NEAR, 50 Tgas. Capture/check the original FINAL receipt and storage/excess refunds. Do not print decrypted values or run verbose/trace.
   Exact future secret command (public values only; keep tracing off):
   ```bash
   H=$(node -p 'require("./docs/evidence/worker-provisioning/candidate.json").wasm_sha256')
   # AUDITOR_PUBLIC_KEY is the separately approved, real 32-byte public key in base64.
   "$OUT" secrets update "$(printf '{"GUARDED_WORKER_HASH":"%s","COLLATERAL_AUDITOR_PUBLIC_KEY":"%s"}' "$H" "$AUDITOR_PUBLIC_KEY")" \
     --project keyhole-devmo.near/keyhole --profile default
   ```
3. Three owner-signed registry batches in [publish-plan.json](publish-plan.json), generated by [the read-only planner](../../../scripts/pledge/publish-plan.mjs): **add_version(active=true) + 4 removals (220 Tgas, exact 0.0044 deposit)**; **9 removals (270 Tgas, zero deposit)**; **9 removals (270 Tgas, zero deposit)**. Every batch is one atomic NEAR transaction to `outlayer.near`. Check exact original FINAL actions and all receipts/refunds before the next batch. A rejected/UNKNOWN batch is never blindly resent or split to bypass a ceiling.
4. Re-read registry: same UUID, active candidate, count 1, exact `WasmUrl` hash/URL. Verify the measured hash, original minter/attestor, a harmless guarded current-holder/canonical-wallet read and compatible downstream clients before lifting maintenance. `info` alone is not registry-gated and cannot reopen service.

This is **6 native transactions** (2 upload chunks + secret merge + 3 registry batches), versus the historical 26 for the original inactive-stage/activate/22 individual removal plan. Configured function-call gas is **810 Tgas** = **0.081 NEAR** at the captured gas price if entirely burned, plus upload/action/refund overhead. This is a conservative configured execution allowance, not exact final burn or an all-in protocol bound. Standard CLI-only registry administration remains valid but uses more transactions and 0.2 gross attachments. Exact direct secret-growth funding could reduce upfront escrow, but CLI 0.2.2 exposes no such attachment flag; no invented option is used here.

The separately reviewed owner/epoch-CAS **v2.6 contract code-only upgrade is an additional prerequisite/transaction**, outside the six worker-publication transactions. Its candidate is 487,260 bytes versus 485,855 live bytes: at the captured byte price the additional code backing is 0.01405 NEAR, not a worker attachment or burned fee; refresh account headroom and deployment gas separately. No initialization or migration is repeated. Publication is native NEAR administration; `--usd` exists only for payment-key top-up. No top-up is needed. The 0.1 CLI secret attachment also exceeds a literal 0.1 all-in per-transaction cap once gas is added; that approval gate is explicitly retained in SECURITY.md.

## Real policy artifact and Q

The provider's actual APIs are [`POST /wallet/v1/encrypt-policy` and `/wallet/v1/sign-policy`](https://api.outlayer.ai/openapi.json). [`keystore-worker/src/api.rs`](https://github.com/fastnear/near-outlayer/blob/3ace18763b1a9cfa35f64cdcdd169287d01e68d4/keystore-worker/src/api.rs#L4490-L4674) decrypt-validates the ciphertext before signing:

`SHA256(store_wallet_policy:v2:{wallet_pubkey}:{version}:1:{valid_until}:{ciphertext_byte_length}:{ciphertext}:keyhole-devmo.near)`

The worker prepares that real artifact internally, verifies the wallet Ed25519 signature locally and keeps reusable ciphertext/signature sealed. Its fixed policy denies contract calls, raw signing, generic message signing, EVM/Solana signing, limit orders, payment checks and external authorized API keys; it retains only the canonical enclave API key's SHA256 and ordinary confidential/swap/exit capabilities. A locked policy requires a reachable named quorum. A separate pinned reviewer must audit actual aliases, old jobs, presigned/MPC/external-chain authority and policy effectiveness, signing the exact plan with a 15-minute maximum approval window. An NFT owner cannot self-assert eligibility.

`collateral_quote` quotes the actual sealed ciphertext using `estimate_wallet_policy_cost({wallet_pubkey,encrypted_data,storage_refund_to:MINTER})`. `provision_collateral` requotes immediately before sending. At current byte price, **Q=(ciphertext UTF-8 bytes +523)×10^19 yoctoNEAR**; **D=0.02 NEAR+Q**, maximum **0.06619 NEAR**. [`wallet.rs`](https://github.com/fastnear/near-outlayer/blob/3ace18763b1a9cfa35f64cdcdd169287d01e68d4/contract/src/wallet.rs#L778-L836) includes the beneficiary's record in this estimate. Q is refundable provider storage to the minter on an authorized shrink/delete; local 0.02 is permanent binding storage. Locked policy deletion is refused until an approved signed update unlocks it; KEYHOLE does not expose a destructive collateral-cleanup shortcut.

**No real fresh token/canonical wallet artifact exists in this read-only task, so actual Q and S are not numerically known.** The 4096-byte bound is not a fabricated quote, and plaintext hash is distinct from the ciphertext SHA256 used in the binding. The missing production writer/submitter now exists in source; live artifact/auditor authorization remain release inputs, not claims of completed provisioning.

## Exit-route fees

Use the new holder-authenticated `withdraw_dry_run` wrapper for the canonical wallet and self-destination only. It calls the documented confidential `/wallet/v1/confidential/withdraw/dry-run` without any withdrawal signature/broadcast/admission. It requires positive `amount_out` and `min_amount_out`, retaining deadline/time estimate and any fee/hint fields. This response has **no `would_succeed` Boolean**. An approval-gated quote does not prove executability, and a dry run does not prove cooldown has elapsed.

The provider's [OpenAPI](https://api.outlayer.ai/openapi.json) states confidential NEAR delivery is a direct NEP-141 transfer, not a public-intents credit. For an unregistered receiver 1Click can register FT storage and deduct it from output. Thus a generic swap fee or a separately purchased FT slot is not an exact exit quote. Solver/bridge/app fees and registration deductions are route-specific; there is no defensible fixed numeric fee before actual B/L destinations and real quotes exist. Record input minus actual quoted output, token/chain, fee bearer and both recipients' registration state. Require the post-A balance to cover B's 0.50-USDC floor net of fees; do not pretend 0.70−0.10−0.10 remains 0.50 when fees consume extra input.

## Bounded compute budget — critical runbook correction

[HTTPS API docs](https://app.outlayer.ai/docs/https-api) and [`CLI api.rs`](https://github.com/out-layer/outlayer-cli/blob/v0.2.2/src/api.rs#L68-L83): **over HTTPS, `--compute-limit` is forwarded verbatim as `X-Compute-Limit`, in microUSD, NOT instructions.** CLI help calls it instructions because the on-chain path reuses the option. Therefore the prior **`--compute-limit 1000000000` means a $1000 compute ceiling**, not 1B instructions. Replace every pilot HTTPS invocation.

Bound the pilot to **20 paid calls total**: first `info` at **40000 microUSD ($0.04)** for compilation, at most 19 subsequent calls at **10000 microUSD ($0.01) each**. Aggregate maximum compute authorization **$0.23**, leaving **$0.284657** from the existing nonce-1 balance. No author deposit, no top-up, no on-chain fallback. The 20-call ledger includes mint, account, preparation, quote, provision, inventory, A/B certificates, both exit quotes/exits, final inventory and at most five explicit recovery calls. GET polls of original call IDs do not start new executions. Exhausting either count or money stops new paid calls; a refused low cap is not permission to raise it or create a new money operation.

The explicit ledger is: **1** info; **2** mint; **3** account; **4** prepare_collateral; **5** collateral_quote; **6** provision_collateral; **7** reconcile_collateral if needed; **8** B's withdraw_dry_run; **9** A certificate; **10** B's A exit; **11** post-A pledge_inventory; **12** B certificate; **13** L's withdraw_dry_run after default; **14** L's exit; **15** final pledge_inventory; **16–20** additional authority-evidence/reconciliation calls only. An unused slot is not an obligation to spend. Any extra audit-history call consumes one of those five slots. Each call after slot 1 is capped at 10000 microUSD; all failed submissions count against the ledger.

Current public prices: base 1000 microUSD, 1/million instructions, 1/second, 10/compilation millisecond; this project has no author-price row. A cap is a maximum authorization, not a guarantee the call can finish. Failed calls can still consume compute. The actual provider admission/reservation response governs whether each next call can start; refresh balance/reservations and save cost receipts. No paid probe was made here.

## Total accounting (no invented exact final fee)

| Component | Amount | Classification |
|---|---:|---|
| Separate CAS contract code backing | 0.01405 NEAR increase at captured byte price | recoverable account storage capital, not a worker attachment; deployment gas separate |
| Native publication gross attachments, batched plan | 0.1044 NEAR | 0.0044 new version storage + 0.1 temporary secret escrow |
| Secret refund | 0.11091 − S NEAR | automatic excess; actual merged row required |
| Old-version release | expected 0.0968 NEAR | recoverable old storage; verify recorded deposits/receipts |
| Publication execution allowance | 0.081 NEAR + upload/action overhead | configured upper execution allowance; actual gas lower/unknown |
| Minter+B+L payout slots | 0.0096 NEAR | permanent nonrefundable charges |
| Team native capital | 0.08 NEAR | within-team capital, not fee |
| Two account creations | captured quote 0.001669979075 NEAR | protocol-88 creation/action fee; refresh before sends |
| Mint | 0.012 NEAR gross | actual retained storage/excess follows final receipts and pull cashout |
| Collateral binding | 0.02 + Q NEAR, ≤0.06619 | permanent local storage + refundable provider storage |
| Two loan stages | 0.048100000000000000000006 NEAR gross | includes recycled bonds/principal/repayment; not net spend |
| Two exit admissions | 0.02 NEAR gross | backed credits; cashout recovery is separate |
| Enable + optional mint cashout | 2 yoctoNEAR | not omitted |
| Confidential deposit | 0.70 USDC delivered | team collateral capital, not fee |
| Route/provider fees | actual quotes/receipts | presently unknown |
| Compute | **≤$0.23, 20-call ledger** | bounded authorization, existing funds, no top-up |

Gross bookkeeping attachments including account capital and the batched publication are **0.294100000000000000000008 NEAR + Q**. They intentionally double-count later recycling and are not required new capital/net cost. Exact final net cost is irreversible storage/slot charges + actual native gas + route fees + compute, with all refunds/recycling separately reconciled. It cannot be honestly reduced to one numeric NEAR/USD total before actual S, Q, routes and terminal receipts. Nothing was spent in this research.

## Upload wire format and interrupted-chunk recovery sources

[Official CLI v0.2.2 uploader](https://github.com/out-layer/outlayer-cli/blob/v0.2.2/src/commands/upload.rs) uses Borsh Partial variant 1: path, offset u32, full size u32, MIME, chunk vector, batch nonce u32. All chunks share one nonce; reinvocation chooses a new nonce. The offline payload writer fixes the nonce before signing and emits one file per chunk. The [NEAR CLI file-args parser](https://github.com/near/near-cli-rs/blob/master/src/commands/contract/call_function/call_function_args_type/mod.rs) reads binary bytes verbatim, rather than JSON-reencoding them; the [transaction grammar](https://github.com/near/near-cli-rs/blob/master/src/commands/contract/call_function/as_transaction/mod.rs) names the prepaid gas/deposit/signer fields. `0.000000000001 Tgas` is exactly 1 gas. The new writer never loads a credential, invokes that command or sends anything. Its three regressions decode both formats, verify contiguous offsets/full bytes/same nonce and the exact chunk threshold. Record original signed hashes **before** broadcast; an ambiguous chunk stays under maintenance until its original final transaction/indexing state is established. A never-signed next chunk can resume with the saved payload and batch nonce; an UNKNOWN original cannot be replaced.

Native upload/registry templates use the official save-to-file / send-saved-file split, and the local `signed-hash.mjs` verifies the original signature/hash without a key or network. The official secret updater is different: its internal broadcast has no presign flag. The runbook records its pre-call key/nonce/block context and an archival original-transaction recovery procedure; lost output is never a reason to repeat the secret merge.
