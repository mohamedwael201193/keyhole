# Phased confinement API — unpublished worker candidate

Credit: devmo. See [SECURITY.md](../../SECURITY.md#worker-v2-phased-confinement-source-candidate-not-published)
for the precise threat/trust model. Contract v2.7 and loan certificate ABI unchanged.
No publication, secret update, transaction or governance operation accompanies this PR.

All privileged operations need fresh FullAccess holder NEP-413 auth, recipient
`keyhole`, signed params `{token_id,owner_epoch,...}`. No session/EIP191 fallback.
`owner_epoch` and `provision_owner_epoch` are decimal strings. All signed audit
wire fields are defined by strict Rust structs in `collateral_evidence.rs`:
use those exact types (including numeric u64 issued/expires fields), not guessed
JSON schemas. Signed bytes are exact `DOMAIN + "\n" + message`; changing whitespace
requires a new signature. Hashes use SHA256 of recursively key-sorted JSON objects,
array order preserved, no floating point. Reviewer key is pinned in existing
`COLLATERAL_AUDITOR_PUBLIC_KEY`, base64 raw32-byte Ed25519 public key.

1. `create_collateral_wallet`: `{fresh_only:true}`. Only a never-adopted canonical
   wallet; output sanitized manifest/hash. One provider POST, unknown stays held.
2. `collateral_candidate`: `{approvers:[{id:GUARDIAN,role:"admin"}],threshold:1}`.
   Returns exact candidate policy/hash, manifest and guardian message template.
3. Before install, `collateral_funding_quote`:
   `{chain:"base",token:"USDC",amount:"900000",min_credit_raw:"800000"}`.
   Sole canonical confidential destination. Inspect actual min/expiry/one-time
   Base address, manually fund from approved source, then poll
   `collateral_funding_status` until original request success + actual private
   floor/inventory verified. No public fallback, no replacement POST. `intent_id`
   is the identifier returned by the documented deposit endpoint for its request
   polling; a provider404/unknown mapping is a STOP, never a guessed replacement.
4. Guardian signs fresh normal NEP-413 message using the template from candidate,
   updated chain ts_ms and random nonce. `op` is `collateral_guardian`, account is
   actual guardian; exact params bind policy, wallet, owner/epoch, project/C/H.
   It is **not** a policy-write approval.
5. `prepare_collateral`: same approvers/threshold plus `guardian_proof:AUTH`.
   Returns actual `provision_id`, exact policy/hash, manifest/hash, observed guardian
   bundle/hash. A repeat with a fresh guardian proof refreshes review evidence
   without another encrypt/sign POST; omit it only to reread the original bundle.
6. Genuine team reviewer signs PreAuditV2, prefix
   `KEYHOLE_COLLATERAL_PRE_AUDIT_V2\n`; issued/expires ≤900s. No installed-policy claim.
   `collateral_quote {provision_id}` returns actual Q and D=.02+Q. Enforced
   Q≤.04619NEAR, D≤.06619; enlarged admin policy must still fit.
7. `provision_collateral`: `{provision_id,pre_audit_message,pre_audit_signature,
   max_deposit_yocto}`. Rechecks actual current guardian/key/freshness, no binding,
   exact storage quote/budget and owner/epoch; M submits unchanged protocol2.
   Output installed/UNKNOWN is not eligibility. Never resend UNKNOWN native jobs.
8. `reconcile_collateral {provision_id,provision_owner_epoch}` resolves original.
   Without a new guardian proof it returns `eligibility_sealed:false` and a request
   for fresh guardian evidence. `collateral_report` with these params plus new
   `guardian_proof` returns authenticated plaintext, inventory and signed report.
   New current holder can report the original plan using original provision epoch.
9. Reviewer reads actual report/public/private observations and separately signs
   PostAuditV2, prefix `KEYHOLE_COLLATERAL_POST_AUDIT_V2\n`, report hash from output.
   `finalize_collateral {provision_id,provision_owner_epoch,report_sha256,
   post_audit_message,post_audit_signature}` fresh rechecks and seals proof first,
   V1 marker last. Require true `eligibility_sealed` before lending.
10. Existing `loan_certificate {token_id,loan_nonce}` now requires verified V2
    companion and V1 marker, then all existing live loan/frozen policy/floor guards.
    The old certificate bytes/signature domain are unchanged.

Optional `claim_minter_credit` needs contract-owner fresh NEP-413, no arbitrary
method/receiver/amount: fixed M→M claim_payout, idle credit0<amount≤.1NEAR,
70T+1yocto and existing original-hash native WAL. Use original reconciliation,
not repeated claim, if unknown. It does not export M or sweep its capital.

Official schemas: https://api.outlayer.ai/openapi.json ;
https://skills.outlayer.ai/agent-custody/references/register-and-auth.md ;
https://skills.outlayer.ai/agent-custody/references/confidential.md .
