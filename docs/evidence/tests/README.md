# Test count

Produced by `scripts/test-count.sh` (passing tests per suite; a property test counts once). E2E needs a running site (`E2E=1`); its numbers come from the CI log.

At commit `d0305f2` ([CI run 41731806624](https://github.com/mohamedwael201193/keyhole/actions/runs/41731806624), all six jobs green):

```
contract         119
sandbox            6   (contracts/keys-sandbox, run in the contract job)
worker           432
cli                7
web-unit         916
e2e               71   (135 passing runs + 5 skipped by design at 1440 and 390 px; the funded-payment-key test is excluded in CI)
TOTAL           1551
```

History: 1336 at `08fa468` ([CI run 41677252319](https://github.com/mohamedwael201193/keyhole/actions/runs/41677252319)); 488 at `ea2601b` ([CI run 41516049447](https://github.com/mohamedwael201193/keyhole/actions/runs/41516049447)); 447 at `5f4502b` ([CI run 41496705855](https://github.com/mohamedwael201193/keyhole/actions/runs/41496705855)); 438 at `521d3c6`; 292 at `57855b1`; 260 at `67ce93b`.
