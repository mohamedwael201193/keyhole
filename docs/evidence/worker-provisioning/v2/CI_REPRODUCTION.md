# PR208 local CI reproduction — source candidate, not published

Credit: devmo. Original hosted run: https://github.com/mohamedwael201193/keyhole/actions/runs/43069363607

The completed failed-job logs were read with `gh run view --log-failed`, from the
requested wt_live_v25 worktree using `GH_TOKEN=$KEYHOLE_GITHUB_TOKEN` without
printing the credential. Raw logs and the original local reproductions remain
under `/workspace/handoff/pr208-*` on the review box.

- cli: stale guard-line assertion, independently reproduced 76/77; corrected
  CLI/web tables and retained named guard/semantic refusal assertions.
- judge-kit: zero-install live hash/version mismatch v2.6 vs actual v2.7;
  independently reproduced, then strict public-read verification passes.
- contract: the final live-byte step had the same v2.6 mismatch. Replayed the
  original script locally and observed refusal; the corrected strict script
  passes without changing ANY contracts/ files or deploying anything.
- web: missing collateral_unknown UI catalog/copy and both source-bundle pin
  failures. All four failures were independently reproduced. Error coverage is
  repaired; the final source/pin commits refresh the immutable archive rather
  than weakening the source consistency tests.

Current raw worker, JS, receipt, CLI, strict clippy, actual dual WASI hashes,
public-read live identity, web build/lint/types and browser logs are in this
folder. The full web unit log is captured after the final archive/pin commit at
`/workspace/handoff/pr208-web-final.log` so committing a log cannot invalidate its
own source-pin test. No hosted checks on the new local head can exist before the
owner pushes it. Hosted green is therefore a required post-push gate, not a
claim made by these local results.

The browser consent/recovery fixture explicitly simulates a hypothetical
minimum-bound execution transport, so its existing race/consent assertions remain
reachable without pretending the current provider supports it. A separate actual
component/production-helper test refuses the real advisory preview before any
withdraw signature or execution. Unit tests and the real provider driver also
refuse all new/retried unbound withdrawals; read-only original-ID recovery remains
available. No funded live or sandbox transaction acceptance is asserted.
