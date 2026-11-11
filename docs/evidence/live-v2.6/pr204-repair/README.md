# PR204 CI and R1 integration repair

Completed locally **2026-11-11T02:32:04.711455+02:00 Africa/Cairo (UTC+2)** on `chore/live-v2.6`. No push, production deployment, mainnet transaction, paid worker call, key/secret mutation or lending enablement. No Rust source, contract/worker Wasm or Cargo lockfile changed from pushed head536851a. This is a verifier/distribution/documentation/fixture repair, not another cutover.

## Exact hosted failures, fetched with gh

Original run42927693796 at pushed commit536851adb92fce5a58c4523ec2db1fd3937db6d7: hygiene/judge-kit/web FAILURE; contract/worker/CLI now SUCCESS. Once the contract completed, all three exact failed logs were fetched using `gh run view --job … --log-failed`, with only the requested token field passed privately as `GH_TOKEN`. The token was never printed. Earlier gh attempts correctly reported that logs were unavailable while the run was in progress; the independent R1 logs supplied the interim diagnostics. Only fetched-log digests/lengths and job IDs are committed (`hosted-failures.public.json`), not raw hosted logs.

- **Hygiene:** the actual failure was old packed worker d337e822 versus current62398a8a (and stale v2.5 source contents), NOT the secret-pattern step. The precise existing secret check remains. Bundle checks are strengthened to compare the full current worker/contract identity, including proof history, plus both candidates.
- **Judge-kit:** generated claims were stale, so regeneration produced a Git diff. Full local follow-through additionally exposed the historical v2.5 promotion fixture and reproduction assertions. The legacy validator is now tested on an explicit historical identity; a new test proves that same path still refuses to downgrade actual live v2.6. No rollback/promotion guard was removed.
- **Web:** eight initial failures came from missing current proof/hash pin, dropped previous build, stale current-build/claim fixtures and missing current publish/hash row. All are fixed rather than skipped.

## R1 B1: current default output and all historical proofs

The existing measured info call962d4374-b9ec-411a-9efa-973b36260431 now has its sanitized public `{call_id,output}` file, EVIDENCE_IDS registration, actual public attestation fixture and exact output commitment `e7fb60372ffdda802b9d5326864fb2b9a8decefe9bad670c72566b9ae3c864f3`. No paid reprobe. The measured current output names35 ops, not the old25.

The browser and CLI derive history from the pinned identity. All **17** pre-cutover accepted builds remain accepted for historical proof checking, including d337e822 and cc8d2fa8; only62398a8a is current. Unknown hashes remain refused. Pure promotion preserves history on rotation and idempotent repeat. The old d337e822 info selector and public output remain. Accepting old proofs does NOT republish executable old versions: the live registry remains the one-version reviewed62398a8a singleton. `history-preservation.public.json` compares the complete sets with reviewed main.

Browser/CLI expectations, published hash pins,35-op checks and current publish tx now reflect live facts. The real final browser run checks current output HTTP200 and its canonical attested hash, all six attestation rows, current verdict, previous verdicts, binding/DCAP/PCS and negative tampering. `judge/3-verify.sh` selects current info from identity; CLI verification of both current962d4374 and previousdc3668db passes (`current-verifier.log`, `historical-verifier.log`).

## R1 B2: coherent immutable distribution

The immutable tested code snapshot is **75c97e5d42b779d48c4a2d224438ffcb06f55156**. The final metadata commit pins that snapshot; a Git commit cannot contain its own final hash. Generated checkout/raw references, identity TS, source manifest and checksum agree. The owner's next push makes this local source anchor remotely fetchable; no push is claimed here.

Source tarball **7376931 bytes**, SHA256 **5f36a4295b5d17003309c501459d440c7b1a07839ae94aed4dabd76aff6ebaf7**. Its own extracted zero-install judge—not substituted current files—returns **9 PASS,0 FAIL,0 ERROR**, with live v2.6/62398a8a identity. Regressions require full packed/current identities and a registered packed default proof with the correct attested output hash. This prevents the exact stale-bundle failure recurring.

## R1 B3: zero-failure claims and honest current documentation

Generator checks for worker hash/bytes and homepage build now derive from identity, as the contract hash/bytes/version already do. Exact file/build/site predicates remain. Current README/fixtures say v2.6, published guarded worker, self-only NEAR withdrawals, and lending OFF. Track tables describe implemented scope; real custody/operator/history/NVIDIA/advisory/demo limitations remain explicit in SECURITY, not relabelled shipped. Historical evidence and historical migration are retained.

Claims regeneration is byte-identical. **590/590 strict public-read claims PASS,0 FAIL,0 ERROR,0 SKIP**; offline **293 PASS,0 FAIL,0 ERROR,297 SKIP**. All README current count rows match. No health probe or paid compute is used. New historical identity, identity-derived claim and CLI history regressions are explicitly enrolled in hosted judge-kit, without dropping existing steps.

## Per-job local reproduction

| Job | Actual local result |
|---|---|
| hygiene | PASS: unchanged secret-pattern gate; strengthened packed/current identity, candidates, default proof, immutable pin, archive SHA/bytes |
| judge-kit | PASS: live9/9; packed live9/9; recorded attestations/output hashes; current and previous CLI verifier; generated identity; reproducible claims;151/151 Node regressions;9/9 Python receipt tests; strict online contract judge;590/590 strict claims |
| web | Node22.22.2/npm10.8.2 locked npm ci; lint0 errors/10 inherited warnings; typecheck PASS;1793/1793 unit tests; production build PASS;201 browser runs PASS/0 FAIL/0 flaky,15 existing opt-in/width skips; separate real-native funded-Pledge test1/1 PASS with13 FINAL local sandbox receipts |

Final ordinary browser run **2026-11-11T02:28:36.047000+02:00–2026-11-11T02:30:18.959284+02:00 Africa/Cairo**, two widths/two workers, **zero retries**, separate artifact output. The first parallel ordinary/funded invocation shared Playwright's default output directory and caused two ENOENT trace-cleanup flakes; their assertions passed on CI-permitted retry. This was a local harness collision, not suppressed product failures. The final isolated zero-retry rerun is201 PASS,15 SKIP,0 FAIL,0 flaky. Early unit diagnostics also caught the newly exposed previous-link label/index/pin omissions; those were fixed, not excluded from the delivered full suite. One package-root invocation exited before tests and was rerun from web; no startup diagnostic is called PASS.

Funded browser acceptance uses disposable local NEAR accounts and real local native receipts with explicitly mocked custody/keystore/registry/sealing; it is NOT a mainnet pilot or lower-provider confinement proof. Its raw receipt bodies/signatures remain private; only hash/method/status summaries and an original-file digest are retained (`sandbox-funded.public.json`). All owned local test servers/ports were closed. NODE_OPTIONS remained3072MB, Cargo build jobs1; port3100 was not used.

## Deployment and hosted-status boundary

This task does **not** deploy the repaired web. The new default static proof and historical browser fixes are proven over local HTTP and packed distribution; production's missing static proof will change only on the next authorized web deployment. Existing maintenance-OFF production was not modified. Lending remains OFF, and there were no new real calls/transactions/fees. The previous release fee/refund ledger is unchanged.

The old exact-head run is still correctly FAILURE for its three original jobs; no new local head has hosted results before the owner pushes. Local green is not fabricated hosted green, independent re-review or production deployment approval. No secrets, reusable request signatures or signed transaction bytes were added to Git.
