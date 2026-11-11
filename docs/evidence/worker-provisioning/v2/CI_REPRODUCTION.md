# PR208 Round 2 repair — local source candidate, not published

Credit: devmo. Original exact-head run:
https://github.com/mohamedwael201193/keyhole/actions/runs/43073694951

Read-only `gh run view --log-failed` and JSON status were read from wt_live_v25
with the requested environment alias; no credential value was printed. That run
is for 45820d7, NOT this new source: hygiene/contract/web failed and the other
three jobs passed. No hosted check on the new local commits is claimed; pushing
and all six new hosted jobs remain the owner's later release gate.

## R2-01
The new JSON-aware whole-tree checker permits only the exact v2.7 public
transaction-signature pointer after immutable canonical full-schema/receipt
snapshot equality and original TX equality. It rejects wrong/moved/extra
signatures, unknown/duplicate fields, wrong transaction/schema and synthetic
credential classes. Every other field/file and decompressed source-archive
member is scanned. Three historical 1Click public-signature exceptions were
NARROWED from a whole-directory exclusion to exact immutable JSON fields; no
heuristic or file-class scan was disabled. Diagnostics print paths, not matches.

## R2-02 — explicitly smaller native scope
Both withdrawal denials remain. A shared production adapter contains every
post-gate custody/spend/sign/admission effect; injected transport tests exercise
it and the real journal driver. Missing/wrong/stale quote/minimum/owner/asset/to/
deadline and caller capability flags never dispatch. Original-ID recovery is
GET-only; missing ID/unsolicited provider success cannot create new recovery.
These tests do not retrofit minimum guarantees onto old unbound operations.

Cross-layer/native UI now assert intentional refusal rather than successful
public exit, without removing any repay/default/title/payout assertions. The
sandbox suite uses the exact current v2.7 release: the old 1-NEAR conservation
fixtures are explicitly Gold (unchanged production caps); the separate real UI
is Bronze with 0.01-NEAR loans. Its certificate-only fixture uses the same actual
Bronze terms. No cap, floor, amount/conservation assertion or test was disabled.
The existing opt-in nonterminating UI-server test remains opt-in and was launched
for the funded test; no new skip/ignore was introduced.

The funded test retains 13 unique FINAL wallet receipts, 64 state/viewport
checks and 96 screenshots, adding explicit no-POST/no-custody-sign/no-admission/
no-withdrawal-signature checks for both holders. Full artifacts are retained
outside Playwright's auto-cleaned output under the local handoff evidence
folder; funded-native-summary.json binds their manifest/receipt/evidence hashes.
Custody HTTP/registry/WASI host are labelled mocks, not live TEE/provider proof.

Runbook/design copies implement native A repayment/release and B default NFT
title/confined control only. Public FT redemption remains unavailable. The
read-only integer budget and closed FINAL-receipt graph gates cannot stand in
for actual cost, ingress, policy, attestation or destination proof. SECURITY.md
states those assumptions and the provider addition needed for any future exit.

## Diagnostic history and source pin
Initial local diagnostics found the ignored callback-failure fixture missing;
it was rebuilt from unchanged production source, not fetched from a provider.
Moving the sandbox to current v2.7 exposed old test principals above their tier
caps; fixture tier/actual Bronze terms were corrected, not production safeguards.
One first web run hit a 5-second postinstall-test timeout during concurrent clean
Rust compilation; its bounded-worker rerun passed without changing timeouts or
assertions. Final-pin diagnostics also caught a newly linked proof increasing offline claims
to641 (344 PASS/297 SKIP), a missing CLI npm typecheck alias (the actual check is
`npx tsc --noEmit`), and inherited sandbox environment flags in a normal web
unit invocation. README counts were corrected, the alias was not invented,
and those task-local flags were cleared; no assertion or feature gate changed.
Superseded diagnostic logs remain under
/workspace/handoff/pr208-native-scope/ and are NOT counted as final passes.

Current counts/output-log hashes are in validation.json. Committed output logs
only normalize trailing empty lines; original raw logs remain in the handoff folder. The final post-pin full web unit
run is retained in the handoff directory so committing its log cannot invalidate
its own immutable-source-pin guard. Source/identity/archive checks are refreshed
without weakening that guard. No mainnet signature/transaction, worker publish,
secret change, push or merge was performed; all value transactions here belong
to disposable local sandbox accounts.
