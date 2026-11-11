# Main-source maintenance deployed; native release held on execution RPC anomaly

Source: merged main `9d661db70a70e00e4d23544fc75dbc523d17e626`. No financial source or release gate was changed or bypassed.

## Completed

- Explicitly excluded the `FNe2…sQ6h1` social-only FastFS key from the release pause inventory. The key was not removed or changed. Actual owner/deployer, owner Meteor, enclave minter, local beat and gateway/operator payment paths were enrolled. Own-key acknowledgements were signed for the locally held deployer and beat keys; the explicitly authorized operator release key attests the human-wallet, enclave and server/CLI pauses. Native public keys remain bound in each enrolled ID. Real signatures stay outside Git.
- No active box worker submitter was found. The only matching project node process was this operator's Vercel deployment CLI, not a worker caller. No unrelated process was stopped.
- Provider REST paging works: `GET /public/payment-keys/keyhole-devmo.near/1/usage?limit=100&offset=N`. All **733 unique entries** were read: **729 completed, 4 terminal failed compute jobs, 0 pending**. Failed jobs are not relabelled successful delivery. Newest 100 span from 9 November 06:51:36 to 10 November 19:31:11 Africa/Cairo; all those 100 completed. Nonce-1 reservation was zero and spending stayed unchanged through the maintenance probes.
- Set production `KEYHOLE_MAINTENANCE=1` at **11 November 00:50:02 Africa/Cairo**. The initial web-only deployment failed type-checking because the upload omitted the reviewed sibling `protocol/loan-certificate-v3-delivery.json`; no test or type-check was disabled. Corrected the deployment packaging by setting this Vercel project's `rootDirectory` to **web** and deploying the complete reviewed repository from its root. Future CLI deploys must therefore run from the repository root, not from web/.
- Correct complete-source deployment became READY/aliased at **00:56:52 Africa/Cairo**. Production: `https://keyhole-seven.vercel.app`; immutable deployment: `https://keyhole-mgc182sxg-mohamedwael201193s-projects.vercel.app`. Verified maintenance at **00:57:38 Africa/Cairo**: invalid JSON, info and malformed signed-operation inputs on both `/api/keyhole` and `/api/worker` return **503 + exact no-store**, without new compute charges. Final status evidence retains homepage **200**, both worker aliases **503/no-store**.
- Native approval ceiling was exactly **0.05 NEAR**, covering the current 0.04405 minimum backing/gas floor. Actual real-key signatures and full maintenance/native inputs passed **both predeploy gates**. Candidate bytes/hash remained correct. Full private authorization/checkpoint packets are not committed.

## Real runtime stop

The unchanged `--execute` repeatedly refuses a fresh RPC execution-context read with **HTTP 429** before creating its exclusive durable dispatch journal. The execution program was never allowed to reach broadcast. Fresh packets after read cooldown/pacing retained all old never-dispatched signatures; no ambiguous/UNKNOWN send was retried. The default RPC still returned 429 at 150ms pacing after a cooldown. A passive official-mainnet capture succeeded but took about 98 seconds, longer than this tool's 100-finalized-block freshness window; a documented alternate provider's health read failed. No unsupported API, credential workaround, gate weakening, blind send or automatic rollback was used.

The prepared hashes are **not on-chain transaction hashes with FINAL/failed/UNKNOWN outcomes**: they identify local never-dispatched saved signatures only. No `deploy.wal.json` exists. The final preservation read independently checks the six NFTs/owners/epochs/raw rows/credits/config and unchanged deployer nonce, using public official RPC without attempting another execution.

## Handoff state

**Maintenance remains ON; no off time.** Contract remains v2.5, worker remains d337e822, lending remains OFF. Native broadcasts **0**, worker-admin transactions **0**, paid calls **0**, fees **0 NEAR / $0 compute**. No native deploy-post/restore gate or identity promotion is claimed. No initialization, migration, provisioning, loan, key mutation or push occurred. No server was started.

Resolve RPC capacity/request availability while preserving the reviewed freshness checks. Then obtain fresh before/approvals/signatures; these old packets are stale and must not be blindly submitted. Use the same still-unused exclusive deployment journal path. The six worker-admin steps and actual restore gate remain unperformed. Do not lift maintenance on the strength of a predeploy PASS alone.

Final independent official-RPC preservation: **PASS**, canonical block **223982733**; six NFTs, six controls, eight credit accounts, 47 raw rows, all listed state fields equal and deployer nonce unchanged. `final-preservation-summary.json` carries the actual Africa/Cairo snapshot and verification times. It is a held-state read, not a deploy post-check.
