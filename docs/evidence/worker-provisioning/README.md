# Collateral provisioning proof

The worker contains an enclave-only, signed-holder provisioning path, a separately approved confinement-audit writer, actual-payload storage quotation and holder-only exit previews. Author: **devmo**.

- [Production dispatcher](../../../tee/worker/src/collateral_host.rs): `prepare_collateral` → `collateral_quote` → `provision_collateral` → `reconcile_collateral`. Policy ciphertext, reusable wallet signature, API key and minter key stay sealed; public outputs are non-reusable identifiers, quotes and receipt hashes.
- [Production validators](../../../tee/worker/src/collateral.rs): provider Ed25519 verification over the actual caller-bound v2 message; a separately pinned review key approves the exact plan, build, wallet and epoch; immutable eligibility writes follow only the original FINAL registration and exact controller/policy/binding readback.
- [Worker regression tests](../../../tee/worker/src/collateral/tests.rs), [real local NEAR integration](../../../contracts/keys-sandbox/tests/support/guarded_layer.rs), [validation record](validation.json), [worker log](worker-tests.log), [sandbox log](sandbox-all.log), [offline log](offline-tests.log).
- [Generated source identity](candidate.json), [first rebuild](build1.sha256), [second rebuild](build2.sha256). Live worker identity remains separate in `identity.json`.
- [Read-only research and cost accounting](RESEARCH.md), [future execution sequence](RUNBOOK_DELTA.md), [unsigned publication batches](publish-plan.json), [planner tests](../../../scripts/pledge/publish-plan.test.mjs).

Reproduce locally, sequentially:

```bash
(cd tee/worker && CARGO_BUILD_JOBS=1 cargo test --locked -- --test-threads=1)
node --test scripts/pledge/*.test.mjs
(cd contracts/keys-sandbox && CARGO_BUILD_JOBS=1 cargo test --locked --test pledge -- --test-threads=1)
CARGO_BUILD_JOBS=1 bash tee/worker/build.sh
node scripts/gen-identity.mjs --worker-candidate --check
python3 judge/gen-claims.py .
node judge/verify-claims.mjs --offline
```

[First missing-fixture diagnostic](sandbox-missing-fixture-diagnostic.log) is retained. Sandbox preparation follows the CI recipe: build its labelled callback-failure fixture before running the complete suite. HTTP custody, encrypted storage and provider policy in sandbox are explicit fixtures; actual NEAR contract execution establishes receipt ordering and value-admission serialization. The audit, receipt and policy validators are the same production library used by the WASI dispatcher. Deployment/release gates and trust boundaries are recorded in [SECURITY.md](../../../SECURITY.md).
