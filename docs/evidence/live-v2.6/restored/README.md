# v2.6 restoration PASS; production maintenance OFF

Final verification **2026-11-11 01:55:32 Africa/Cairo (UTC+2)**. All changes committed locally on `chore/live-v2.6`; no push. The earlier [held restoration record](../worker-published-restore-held/README.md) is historical and remains unchanged.

## Source-proven gate repair

[Reviewed worker analysis, official provider schema and regression evidence](../route-gate-repair/README.md) establish that the worker forwards optional provider metadata, with JSON Null when missing/null. For this exact native NEAR USDC same-asset self-preview, null deadline/estimated_fee/fee_token are valid absent metadata, NOT a zero-fee claim or assurance that an eventual withdrawal avoids intents, bridge, approval or cooldown.

The exception is narrowly bound to NEAR, the reviewed native USDC asset, authenticated current holder, identical positive amount_out and requested amount, positive minimum no greater than output, all three metadata fields explicitly null, and broadcast:false. All existing measured-worker/project, attestation/hash, holder/epoch, registry/idle and strict canonical-wallet checks remain. Quoted/different asset or output routes retain fee/token and future-deadline checks. A quoted route with nulls FAILS. Missing or mixed metadata, foreign receiver, nonpositive/impossible output and broadcast are negative tests. No contract or worker bytes were changed. Fix commit `1495639de485d69ef5e375e0a5d5d8c9e9735b76`.

## Fresh real measured reads, gates and promotion

Old signatures were not reused: a new read-only NEP-413 preview and fresh signed restoration envelopes were collected privately. Exactly two additional official CLI calls, both SUCCESS, each ceiling10000 microUSD, exact reviewed worker and existing default secret profile/payment nonce1:

| Call | ID | Cairo time, 11 Nov | Actual microUSD |
|---|---|---|---:|
| info | `962d4374-b9ec-411a-9efa-973b36260431` | 01:49:30 | 1004 |
| withdraw_dry_run | `e4ee1416-121f-4cbe-9f60-f32350a92a18` | 01:49:32 | 1010 |

Preview token0/current holder/epoch0, NEAR-native USDC100000 base units, output100000, minimum99000, null optional metadata, broadcast:false. Public attestation commitments and outputs are in `new-measured-reads.public.json`; full signed inputs, auth envelopes and TDX quote remain outside Git. `restore-gates.log`: **5/5 PASS**, phase restore PASS. `all_mainnet_gates=false` is intentional: no loan pilot was run and lending remains OFF. A genuine successful restore checkpoint was minted; only its public block/hash/snapshot is retained here. `promote-worker.log`: PASS, generated identity pinned to reviewed worker `62398a8a…cc307f` and contract `6hk2duib…Boww`. Promotion/deployed source commit `7ac5dad0192a558ab06688010b3612e0ff4aaf7b`.

Additional compute **2014 microUSD=$0.002014**; cumulative release compute **4026 microUSD=$0.004026**, **4/20 calls**, total authorized ceilings70000 microUSD, below$0.23. Current existing-key available balance$0.510631, reserved0. Its lifetime spent$0.778063 includes earlier non-release use and must not be misreported as this release's spend.

**No new native transaction, withdrawal, fee, key mutation, top-up, new/migrate/migrate_pledge, loan or rollback in this restoration.** The [nine-original-transaction ledger](../worker-published-restore-held/README.md#original-transactions-and-measured-native-fees) is unchanged: cumulative native burn **0.0237255344705087 NEAR** <0.1; confirmed storage/excess refunds **0.1956 NEAR**, separate from gas refunds. Retained additional code storage0.01405, new-version0.0044, net additional secret storage0.0012 NEAR.

## Maintenance-OFF production deployment

`KEYHOLE_MAINTENANCE=0` in production. Deployed from **repository root**, with project **rootDirectory=web**, production build staged using official `vercel deploy . --prod --skip-domain`, then official `vercel curl` checks and `vercel promote`. No auth bypass, new credentials, project or domain mutation. Public CLI receipt: `deployment.public.json`.

Handwritten web is identical to reviewed main `9d661db70a70e00e4d23544fc75dbc523d17e626`; the **only** web delta is authorized generated `web/lib/identity.gen.ts`. The gate/test fix is not production runtime code. Thus the release checkout uses unchanged main web with the required reviewed identity promotion, not unrelated release web fixes. `deployment-source.public.json` records the exact source decision.

- Production URL: **https://keyhole-seven.vercel.app**.
- Deployment: `dpl_3WH9uTUgttfGcMPDt5V8STTt8ePS`, READY.
- Immutable URL: https://keyhole-7wl2s500y-mohamedwael201193s-projects.vercel.app.
- **Maintenance OFF promotion completed 2026-11-11 01:54:55.996329 Africa/Cairo**.
- Production checks **01:55:09–01:55:12 Africa/Cairo**: `/`200; `/api/keyhole`400 and `/api/worker`400 for intentionally invalid JSON, proving maintenance no longer intercepts them with503 without dispatching compute. Normal server-side read `/api/keys?account=keyhole-devmo.near`200 returned holder's token0/tier1: real public-chain read flow, no paid compute. `/api/health`200 is explicitly passive/not_probed, NOT an active worker-health claim. Both staging and production receipts are retained.

## Final preservation and tests

Final paced finalized dRPC capture at block223987892, hash `97jWJu2ugppeD8QqRxgxjjAq3svp6K6XAkWfzH1g2nVN`: full original raw state rows, all six NFTs/owners, controls/epochs, credits and configs preserved against the original predeploy snapshot; exact v2.6 code487260bytes/SHA256 `54ba51b3d7d256820e751c9fa4e0cda55c66b30111a186c6d9eff03b561b7b8a`; registry UUID unchanged, singleton reviewed worker active. **Lending OFF**. `final-preservation.public.json` contains the snapshot commitment without raw secrets.

- Final **strict online contract judge PASS** on dRPC, with previously tested honest User-Agent: exact committed code bytes/codehash, version and minter (`final-strict-judge.log`).
- **119/119 release/pledge tests PASS, 0 FAIL**, re-run after promotion (`final-release-pledge-tests.log`), including both null/quoted route positives and quoted-null/stale/mutation negatives.
- **8/8 web maintenance/health/pledge gateway tests PASS**, 3files, declared Node24 and locked npm ci (`web-gateway-tests-final.log`). First local attempt lacked installed dependencies; after successful locked install, nested npm exec inherited outer npx options and exited EUSAGE before tests. Invoking the declared `npm test` script under Node24 fixed this harness issue; no package/lockfile edits or audit fix. No earlier startup failure is presented as a passing test.
- Generated identity check PASS (`identity-check.log`). No public monitor, loan pilot or unrequested paid active probe was enabled.

Only sanitized receipts/commitments are retained. No credential, reusable signature, full signed packet, secret value or encrypted secret transaction body is printed or committed.
