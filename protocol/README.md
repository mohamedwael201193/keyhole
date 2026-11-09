# Prepared pledge/admission interface (not deployed)

Source of truth: `contracts/keys/src/pledge.rs` and the v2.4-compatible Contract in `lib.rs`. Lending starts OFF after the one-time self migration. No web or guarded worker is claimed shipped here.

## Admission

- `get_control_state(token_id)` returns token id, decimal-string `owner_epoch`, `pending_value_ops`, `value_op_nonce`, and boolean `listed`, `transfer_pending`, `pledged`. Missing/malformed/unavailable fields must fail closed in the guarded worker.
- Minter-only payable `begin_value_op(token_id, epoch, op_id, action_hash, owner_id)` validates the authenticated current owner AND epoch atomically, no listing/pledge/transfer-call and no concurrent value admission. `op_id` is `<next nonce>:<unique action suffix>`, maximum85 bytes; `next nonce` is last+1, not an independently sampled counter. Worker uses a 64-hex action suffix. Maximum worker storage budget0.01NEAR; actual positive storage growth retained, surplus refunded. No treasury attribution.
- A bounded single last-operation record under Vo plus monotonic nonce replaces unbounded tombstones. Old ids cannot be admitted again or finish a newer operation. E/Vo/Vc prefixes remain; only the undeployed v2.5 proposal ABI changes.
- `get_value_op(token_id, op_id)` returns the latest matching record only (`epoch`, `action_hash`, `state`, `nonce`, `op_id`). State0/1 means pending, 2 reconciled success, 3 reconciled failure.
- Minter-only `finish_value_op(token_id, op_id, success)` may be called ONLY after terminal custody reconciliation. HTTP timeout, error after submission, missing request id and `needs_review` are not terminal proof and must keep both lock and spend charge. No elapsed-time unlock.
- Begin must be confirmed before swap/copy/withdraw, wet quote or signature-capable dispatch. Immutable request journal/idempotency key must precede submission. No generic signing escape for bound collateral. Token lock and global monotonic loan nonce prevent opposite receipt orderings from exposing a funded pledge to an admitted value operation.

## Sealed floor certificate

`loan_certificate_template(token_id, observed_at_ns, expires_at_ns)` returns authoritative immutable fields but DOES NOT certify the balance: `floor_met:true` is a template awaiting the pinned attestor's verified signature. Never present an unsigned template as proof.

The attestor must read the exact stored wallet binding without creating/rebinding it, confirmed current controller/locked/version/policy digest/freeze, pending operations and eligible custody authorities. It compares the fixed USDC raw balance to on-chain `terms.floor_raw`. Caller cannot select another asset/floor/nonce. Full balance never leaves the holder/worker scope. Live confinement eligibility/version retirement remains a rollout prerequisite; mocks cannot establish it.

The signature message is canonical Borsh `LoanCertificate` in declaration order (UTF-8 string = u32 little-endian byte length then bytes; AccountId = string; U64/U128 = little-endian integer; Base64VecU8 = u32 byte length then raw bytes; bool =0/1). `LoanTerms` is nested inline in declaration order. Domain `KEYHOLE_SEALED_LOAN_V1`. Fixture `loan-certificate-v1.json` contains exact certificate, Borsh hex, signature and verification public key from a deterministic TEST-ONLY seed. It is not a production secret or live attestation.

Funding validates pinned Ed25519 signature and exact field equality against authoritative template: network/contract/token/global loan nonce/borrower/owner epoch/all immutable terms/asset/wallet/policy version+digest/observation/expiry/floor_met/frozen/pending0. Validity is at most60seconds and not future-dated. This is a trusted-attestor statement, not an on-chain Intel measurement verifier or ZK proof.

## Settlement and recovery

Freezing -> Offered -> FundingPending -> Active -> UnlockPending. Active debt starts only on native principal delivery success. Failure credits lender without borrower debt. Exact repayment funds lender pull credit before thaw. Default validates eligible receiver, transfers title/epoch/clears approvals, then waits for confirmed thaw; unknown custody state keeps every value/title lock. Bond credits remain liabilities until payout success. Private nonce/phase/sequence-bound callbacks ignore stale results and failed native transfers restore credits.

`migrate_pledge` pins recovery account/attestor/custody contract/network once. Recovery unlock1796169600000000000ns = December2,2026 02:00 Africa/Cairo. Recovery predecessor and destination are the same fixed account. Amount is bounded by explicit treasury ledger AND unencumbered native after user liabilities, listing deposits, pending treasury payout, storage and0.1NEAR reserve. Legacy capital starts unattributed. Only explicit treasury funding and future self-directed built-in sale royalties credit the ledger. No vault assets, escrow, NFT, arbitrary call, DeleteAccount or upgrade escape hatch.
