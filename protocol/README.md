# Prepared pledge/admission interface (not deployed)

Source of truth: `contracts/keys/src/pledge.rs` and the v2.4-compatible Contract in `lib.rs`. Lending starts OFF after the one-time self migration. No web or guarded worker is claimed shipped here.

## Admission

- `get_control_state(token_id)` returns token id, decimal-string `owner_epoch`, `pending_value_ops`, `value_op_nonce`, and boolean `listed`, `transfer_pending`, `pledged`. Unknown tokens reject; missing/malformed/unavailable fields must fail closed in the guarded worker.
- Minter-only payable `begin_value_op(token_id, epoch, op_id, action_hash, owner_id)` validates the authenticated current owner AND epoch atomically, no listing/pledge/transfer-call and no concurrent value admission. `op_id` is `<next nonce>:<unique action suffix>`, maximum85 bytes; `next nonce` is last+1, not an independently sampled counter. Worker uses a 64-hex action suffix. Maximum worker storage budget0.01NEAR; actual positive storage growth retained, surplus refunded. No treasury attribution.
- A bounded single last-operation record under Vo plus monotonic nonce replaces unbounded tombstones. Old ids cannot be admitted again or finish a newer operation. E/Vo/Vc prefixes remain; only the undeployed v2.5 proposal ABI changes.
- `get_value_op(token_id, op_id)` returns the latest matching record only (`epoch`, `action_hash`, `state`, `nonce`, `op_id`). State0/1 means pending, 2 reconciled success, 3 reconciled failure.
- Minter-only `finish_value_op(token_id, op_id, success)` may be called ONLY after terminal custody reconciliation. HTTP timeout, error after submission, missing request id and `needs_review` are not terminal proof and must keep both lock and spend charge. No elapsed-time unlock.
- Begin must be confirmed before swap/copy/withdraw, wet quote or signature-capable dispatch. Immutable request journal/idempotency key must precede submission. No generic signing escape for bound collateral. Token lock and global monotonic loan nonce prevent opposite receipt orderings from exposing a funded pledge to an admitted value operation.

## Sealed floor certificate

`loan_certificate_template(token_id, observed_at_ns, expires_at_ns)` returns authoritative immutable fields but DOES NOT certify the balance: `floor_met:true` is a template awaiting the pinned attestor's verified signature. Never present an unsigned template as proof.

The attestor must read the exact stored wallet binding without creating/rebinding it, confirmed current controller/locked/version/policy digest/freeze, pending operations and eligible custody authorities. It compares the fixed USDC raw balance to on-chain `terms.floor_raw`. Caller cannot select another asset/floor/nonce. Full balance never leaves the holder/worker scope. Live confinement eligibility/version retirement remains a rollout prerequisite; mocks cannot establish it.

The signature message is canonical Borsh `LoanCertificate` in declaration order (UTF-8 string = u32 little-endian byte length then bytes; AccountId = string; U64/U128 = little-endian integer; Base64VecU8 = u32 byte length then raw bytes; bool =0/1). `LoanTerms` is nested inline in declaration order. Domain `KEYHOLE_SEALED_LOAN_V2_CREDIT`. Fixture `loan-certificate-v2-credit.json` contains exact certificate, Borsh hex, signature and verification public key from a deterministic TEST-ONLY seed. It is not a production secret or live attestation.

Funding validates pinned Ed25519 signature and exact field equality against authoritative template: network/contract/token/global loan nonce/borrower/owner epoch/all immutable terms/asset/wallet/policy version+digest/observation/expiry/floor_met/frozen/pending0. Validity is at most60seconds and not future-dated. This is a trusted-attestor statement, not an on-chain Intel measurement verifier or ZK proof.

## Prepaid native-payout account storage

Before a credit-producing role is used, query `payout_account_registered(account_id)`. If false, call payable `register_payout_account(account_id: Option<AccountId>)`, attaching exactly the string-valued `payout_storage_cost()`; `null`/omission selects the predecessor and third-party sponsorship is permitted. Current budget is 320 storage bytes (0.0032 NEAR at the tested byte price), separately paid, permanent and nonrefundable. Re-registration rejects. Do not subtract the fee from principal or a rightful refund. Every ledger is allocated only by registration and reused after cashout, including pending-state capacity.

Register minter, seller, approval owner, borrower and lender before their respective new operations; register treasury before sales paying a pull credit (also self-treasury before pledge initialization), and a buyer before overpayment/stale-buy refunds. An exact-price buyer needing no refund need not register. Missing registration fails closed and synchronous failure reverts title/deposit. Legacy approval refunds require onboarding too. `claim_payout` still sends the entire available amount; storage fees never become claimable. Unknown pending payments stay locked under the same private callback rules. See SECURITY for rollout consent and older-candidate-state boundaries.

## Settlement: backed principal credit, not native delivery

`Freezing -> Offered -> Active -> UnlockPending`. Funding atomically creates the borrower's backed, non-reassignable pull credit and starts the debt/due clock in the same receipt. No principal-transfer promise, principal callback, independent outcome signer or lender-refund selector exists. **Consent must say that principal is a claim credited now, not native NEAR already delivered to the wallet.** A failed borrower cashout restores borrower credit; it does not erase debt or credit the lender. Exact repayment funds lender credit before thaw. Default validates receiver eligibility, moves title/epoch and clears approvals, then waits for exact confirmed thaw. Loan storage is allocated lazily and measured against the borrower's attached refundable bond.

`migrate_pledge(recovery_account,attestor_public_key,custody_contract,network)` pins only the floor signer, fixed treasury beneficiary and custody identity. Recovery unlock1796169600000000000ns = December2,2026 02:00 Africa/Cairo. Treasury is bounded by explicit attribution AND free native balance after liabilities/listing deposits/storage/operating reserve. Legacy capital is not attributed. No generic call, upgrade, DeleteAccount or collateral recovery escape exists.

## Financial callback loss: safety without invented evidence

Claim debits available credit into its immutable pending record **before** native transfer. Only the host's genuine private callback status can consume a paid liability or restore a failed credit. The same rule applies to treasury recovery. Repeated claims, elapsed time, recipient assertions, signatures and current account balances cannot restore a pending payment. The unsafe `reconcile_terminal_outcome` ABI/key and test vector are removed.

**Residual liveness gate:** if that callback is lost, cashout/treasury outcome remains UNKNOWN and locked, even if an external observer believes it knows the outcome. A failed registration with both action callback and provisioning evidence missing likewise stays locked. This is NOT complete keyless financial recovery. No signer service, full callback-loss liveness, live provider support or production rollout is claimed.

## Permissionless provisional NFT restoration

`nft_transfer_call` title is explicitly **provisional until local resolver acceptance commits**. After300seconds, anyone may call `restore_expired_transfer(token_id,epoch)` for the exact still-pending outbound epoch. The contract checks the original reservation/current receiver/no loan/no admitted operation and returns TITLE to the original sender with approvals intact. No caller chooses outcome/payee/amount; a committed acceptance cannot be unwound; stale resolver/timeout cannot affect a newer epoch. Parsing checks the VM register length before allocating at most32bytes and reserves50Tgas; input message is bounded16KiB.

A receiver's unrelated external side effects are **not** reversed by title restoration. Receivers must defer irreversible consideration until committed local acceptance or use a reviewed conditional escrow. Do not interpret a successful receiver receipt alone as final title. A sandbox regression preserves a receiver's treasury side effect while restoring only provisional title.

## Required custody fencing/provisioning extension — mock/source only

The custody controller must enforce `set_wallet_frozen(wallet_pubkey,generation,frozen)` at mutation time: generations increase per wallet across loans; an older generation is rejected, and the same generation is idempotent only for the same desired state. Policy reads must report `generation_supported:true` and the exact generation plus existing controller/digest/version/locked/frozen fields. Reconciliation may issue the **same** fenced command/read after a missing first-stage callback; it never guesses failure or changes desired action. Only exact authoritative state advances the loan. An old freeze arriving after thaw is rejected by custody, not merely ignored locally.

Registration additionally requires `store_wallet_policy(...,registration_nonce)` to atomically record that nonce and the accepted forwarded deposit in the authoritative policy. A later exact read can prove successful provisioning and settle that liability without forwarding twice. Absent/malformed policy is not proof of a refund. A known failed callback can credit the genuinely returned deposit and permit corrected retry.

**The extension is implemented and tested only in the labelled sandbox mock. Existing live OutLayer compatibility is unproven and must not be asserted.** Legacy/unsupported policy snapshots fail closed. Live implementation, independent review and separately approved confinement rollout are prerequisites; no publish/deploy/funding/key removal is performed.
