# Judge kit: verify KEYHOLE on NEAR mainnet yourself

The zero-install path (`./judge/0-live.sh`) needs only `bash`, `curl` and `python3` (standard library). The deeper steps also use `jq` and `sha256sum` (and Node 18+ for step 4). Nothing here uses our keys.

| step | command | what it proves |
|---|---|---|
| 0 | `./judge/0-live.sh` | live `code_hash` equals `identity.json`; `config`, source metadata and supply views; the live worker `info` attestation; one recorded mainnet refusal receipt. No wallet, no Rust, no npm |
| 1 | `./judge/1-contract.sh` | the keys NFT contract on `keyhole-devmo.near` runs exactly `contracts/keys/deployed/keyhole_keys.wasm` (on-chain `code_hash`), and its minter is the TEE-held account |
| 2 | `./judge/2-attestations.sh` | each recorded refusal and trade was produced by the attested worker build; the published output hashes to the attested `output_hash` |
| 3 | `./judge/3-verify.sh [call_id]` (same as `./verify.sh <call_id> --rebuild`) | rebuilds the worker in the current checkout. The sha256 equals the attested wasm only when this checkout is the publishing commit. On this candidate branch the CI worker job warns and still succeeds; that is not live byte equality |
| 4 | `./judge/4-live-refusals.sh` | live, with your own NEAR account: replay and over-cap requests are refused by the TEE right now |

`judge/evidence.json` lists the recorded mainnet calls (over-cap, replay, wrong recipient, tampered, stale, op mismatch, no auth, double mint, confidential swaps, MCP copy with confirmation, withdraws).

Step 4 needs a NEAR account key (`KEYHOLE_ACCOUNT`, `KEYHOLE_PRIVATE_KEY`, or near-cli credentials) and a route (`OUTLAYER_PAYMENT_KEY` of your own, or `KEYHOLE_GATEWAY`). It mints you a free key if you have none (the TEE pays storage), then sends a replayed request and an over-cap request.

## verify-claims statuses

`node judge/verify-claims.mjs` prints PASS, FAIL, ERROR or SKIP per claim. FAIL means the source answered and contradicts the claim (exit 1). ERROR means no source could be reached: every RPC in the fallback list (FastNear, rpc.mainnet.near.org, then archival nodes) or the HTTP source was down (exit 2). It is not a failed claim. Set `NEAR_RPC` to put your own node first. The `claims-online` workflow runs the full online check daily and on demand.
