# Test count

Produced by `scripts/test-count.sh` (passing tests per suite; a property test counts once). E2E needs a running site (`E2E=1`); its numbers come from the CI log.

At commit `57855b1` ([CI run 41485130527](https://github.com/mohamedwael201193/keyhole/actions/runs/41485130527), all jobs green):

```
contract          43
worker            49
cli                7
web-unit         150
e2e               43   (81 passing runs + 5 skipped by design at 1440 and 390 px; the funded-payment-key test is excluded in CI)
TOTAL            292
```

History: 260 at `67ce93b` ([CI run 41474446977](https://github.com/mohamedwael201193/keyhole/actions/runs/41474446977)).
