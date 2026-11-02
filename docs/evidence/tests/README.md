# Test count

Produced by `scripts/test-count.sh` (passing tests per suite; a property test counts once). E2E runs in CI (`E2E=1` locally with a running site); its distinct count is in the CI step summary of each run.

```
contract          43
worker            43
cli                7
web-unit         125
TOTAL            218
commit 1edcede  2026-11-02T15:28:58Z
```

e2e at the same commit, from [CI run 41474446977](https://github.com/mohamedwael201193/keyhole/actions/runs/41474446977): 42 distinct tests (excluding the one that needs a funded payment key), 79 passing runs + 5 skipped by design across the two widths. Total: 218 + 42 = **260**.
