# Collateral provisioning proof

## Current V2 source candidate (not published; not live-loan proof)

Credit: devmo. [Phased V2 protocol](../../worker/confinement-v2.md) · [candidate-scoped validation](v2/validation.json) · [V2 hostile tests](../../../tee/worker/src/collateral_evidence/tests.rs) · [closed readback tests](../../../tee/worker/src/collateral/tests.rs).

The v2 directory holds this candidate's worker/JS/receipt/CLI/web/clippy logs and both actual clean-build hashes. The validation record binds the source-tree digest, artifact, exact counts and the immutable source pin in identity.json. A source test is not a provider installation or a live loan.

## Historical R1–R4 evidence


Historical local repair: [R2 root-fix map and validation](R2.md). Main's merged PR202 fixes are integrated; no mainnet or paid action was taken.

- [CAS contract candidate](../../../contracts/keys/release/v2.6/identity.json) · [owner/epoch and pending-reservation source](../../../contracts/keys/src/pledge.rs) · [real sandbox boundary](../../../contracts/keys-sandbox/tests/support/guarded_layer.rs).
- [Production dispatcher](../../../tee/worker/src/collateral_host.rs) and [shared actual native-send/sign/journal protocol](../../../tee/worker/src/native_send.rs) · [thin WASI adapter](../../../tee/worker/src/native_host.rs).
- [Closed receipt graph](../../../tee/worker/src/receipts.rs) · [audit/policy validators and immutable writer](../../../tee/worker/src/collateral.rs) · [regressions](../../../tee/worker/src/collateral/tests.rs).
- [Generated worker candidate](candidate.json) · [historical validation](validation.json) · [actual dual rebuild log](r2/worker-repro-complete.log). Live identity remains separate.
- [Read-only research and cost table](RESEARCH.md) · [maintenance and exact interruption recovery](RUNBOOK_DELTA.md) · [unsigned publication plan](publish-plan.json).

Run the single complete reproduction fence in the [root README](../../../README.md#pledge-reproduction--source-candidates-and-generated-live-identities). It builds the normal v2.6 artifact and sandbox-only fault fixture, restores normal byte identity, runs the full sandbox and compiles the actual WASI host. Candidate equality is a failing CI gate, not a warning about live/source drift.

Historical R1 raw evidence is retained: [worker tests](worker-tests.log), [sandbox tests](sandbox-all.log), [first hash](build1.sha256), [second hash](build2.sha256), [fixture diagnostic](sandbox-missing-fixture-diagnostic.log). Those are not the new candidate's final results. Detailed qualifications and remaining release gates: [SECURITY.md](../../../SECURITY.md#r2-provisioning-repair-and-cutover-boundary).
