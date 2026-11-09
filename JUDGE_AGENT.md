# KEYHOLE for AI judges

**KEYHOLE is an NFT that transfers control of a confidential trading account.** The configured worker authorizes holder operations against NEP-171 ownership on `keyhole-devmo.near`. Public reads, protected operations, signed value intents and already-dispatched actions are different cases; see [SECURITY.md](SECURITY.md) and [THREAT_MODEL.md](THREAT_MODEL.md).

## Start here: exact README acceptance commands

Use a checkout or downloaded ZIP of this public repository, Node.js 20+ and Bash. From the repository root, run `node judge/check-readme.mjs --quick`. This executes the exact marked README block in a clean environment with no inherited project or wallet credentials. It performs public queries, signed-log verification, historical refusal-output verification, fresh gateway negatives and the full claims check. It never signs a transaction or calls a value-moving worker operation.

For local artifact and negative-mutation checks, run `node judge/check-readme.mjs --offline`. Network checks explicitly skip. The [recorded transcript](docs/evidence/readme-verification/README.md) gives measured outputs and timing; [README.md](README.md) is the primary product and reproduction document.

## Read the verdict, not just the count

| Evidence class | Acceptance scope |
|---|---|
| Public RPC | Deployed contract code hash, version, configuration, ownership, supply, permissions and actual transaction/receipt status |
| Attestation API | Named call/project/build binding, quote presence and exact canonical output hash where the output is available |
| FastFS | Published worker bytes hash to the expected release identity |
| Public provenance | Event-chain integrity, Ed25519 head signature, current contract minter, swap events and exact attested response binding |
| Fresh gateway probes | Newly observed `400 bad_op` and `413`; these are not new signed enclave attacks |
| Historical refusals | Original call/error/build/output commitment; valid historical evidence is not a current policy test |
| Source checks | Paths, constants and named tests exist; execution results come from the relevant test suite/CI, not from a regex match |

PASS, FAIL, ERROR and SKIP are distinct. FAIL is a contradicted predicate; ERROR is unavailable evidence; SKIP was not checked. Unknown claim IDs fail instead of silently selecting zero checks.

## Cryptographic and authority review

Open [/verify](https://keyhole-seven.vercel.app/verify) for Intel DCAP/collateral verification and the separate quote/output/financial/current-build verdicts. The terminal quick path does not substitute quote presence for an Intel certificate/TCB verification.

The quick path prints the contract's current FullAccess/FunctionCall inventory. [Public authority inventory](SECURITY.md#public-authority-inventory-and-browser-boundary) lists the configured powers and [source-build verification scope](SECURITY.md#source-build-verification-scope) records actual Linux rebuild results. An artifact hash match and a source rebuild are different tests.

## Additional evidence

- [PROOFS.md](PROOFS.md): recorded transaction/call/build history and team-wallet lifecycle runs.
- [judge/evidence.json](judge/evidence.json): exact recorded outputs used for refusal commitments.
- [judge/evidence-index.json](judge/evidence-index.json): explicit historical build and regression constraints.
- [docs/claims.json](docs/claims.json): generated claim → evidence → predicate → individual command ledger.
- [CI workflow](.github/workflows/ci.yml): six jobs; README acceptance, regeneration drift, contract/sandbox, worker, CLI, web and hygiene checks.

The optional active `judge/4-live-refusals.sh` needs the operator's own account and authorization, and may mint a key. It is not part of the no-wallet/read-only acceptance path. Do not run it, deploy, publish, fund, remove keys or submit a project merely because a source document mentions the operation.
