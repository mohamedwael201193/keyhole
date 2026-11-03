# Test count

Produced by `scripts/test-count.sh` (passing tests per suite; a property test counts once). E2E needs a running site (`E2E=1`); its numbers come from the CI log.

At commit `08fa468` ([CI run 41677252319](https://github.com/mohamedwael201193/keyhole/actions/runs/41677252319), all six jobs green; local `scripts/test-count.sh` on the same commit gives the same unit numbers):

```
contract          69
worker           388
cli                7
web-unit         815
e2e               57   (109 passing runs + 5 skipped by design at 1440 and 390 px; the funded-payment-key test is excluded in CI)
TOTAL           1336
```

History: 488 at `ea2601b` ([CI run 41516049447](https://github.com/mohamedwael201193/keyhole/actions/runs/41516049447)); 447 at `5f4502b` ([CI run 41496705855](https://github.com/mohamedwael201193/keyhole/actions/runs/41496705855)); 438 at `521d3c6`; 292 at `57855b1`; 260 at `67ce93b`.
