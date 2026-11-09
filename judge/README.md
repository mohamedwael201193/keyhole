# Judge kit

The canonical safe entry point is [the root README](../README.md). Node.js 20+, Bash and network access are sufficient; no npm install, wallet or project secrets are needed.

- `node judge/check-readme.mjs --quick` executes the exact README public verification block in a clean environment.
- `node judge/check-readme.mjs --offline` executes its artifact/mutation checks and explicitly skips network checks.
- `node judge/check-readme.mjs --generate` executes the documentation-regeneration block. CI checks that it leaves docs/claims.json unchanged.

## What each verifier checks

| Script | Scope |
|---|---|
| `readme-verify.mjs` | Public contract/build identities, state and authority inventory; exact recorded refusal output hashes; fresh signed swap-log integrity and current minter; fresh gateway negatives |
| `verify-claims.mjs` | Machine-readable evidence predicates in docs/claims.json; `--only <id>` selects one existing claim; `--offline` skips network predicates |
| `1-contract.sh` | Committed contract Wasm versus public mainnet code hash and configuration; requires curl, jq, Python 3, sha256sum and Bash |
| `2-attestations.sh` | Canonical output hashes of the recorded calls in evidence.json; original build labels are retained; requires curl, jq, sha256sum and Bash |
| Root `verify.sh` | Recorded-call metadata, quote presence, registered/executed hashes and FastFS bytes; its optional source rebuild is a distinct check, scoped in SECURITY.md |
| `4-live-refusals.sh` | Optional active signed requests with the operator's own account; can mint a key; excluded from the no-wallet path |

[Browser verification](https://keyhole-seven.vercel.app/verify) performs the Intel DCAP and collateral checks. Shell quote-presence/hash checks are not a replacement for those cryptographic checks.

## Status semantics

`verify-claims.mjs` prints PASS, FAIL, ERROR or SKIP. FAIL means a source contradicts a predicate (exit 1). ERROR means the source could not be reached after retries (exit 2). SKIP means not checked, including offline network predicates; it does not become PASS. Unknown claim IDs exit 1. Known expected-failure transactions must actually contain a failed receipt, rather than merely exist.

All network inputs are public: NEAR RPC, OutLayer attestations, FastFS, the live site and public GitHub CI. NEAR_RPC can select another public node for the claims verifier. No tool here reads project wallet secrets by default. Historical re-fetches are not new attack executions.

[Recorded command results](../docs/evidence/readme-verification/README.md) · [Trust and source-build scope](../SECURITY.md) · [Claim inputs](evidence-index.json)
