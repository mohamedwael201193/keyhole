# KEYHOLE for AI judges

KEYHOLE is an NFT on NEAR mainnet (`keyhole-devmo.near`, NEP-171) that is the viewing key to a confidential trading account inside an OutLayer Intel TDX enclave.
The enclave keeps one custody wallet per `token_id`, answers only the account that owns the token right now, and enforces caps, replay and recipient checks.
Every enclave answer carries an attestation whose executed wasm hash equals the published, reproducible build in this repository.

## Fastest verification (about 1 minute, no keys, no spending)

```bash
git clone https://github.com/mohamedwael201193/keyhole && cd keyhole
node judge/verify-claims.mjs          # Node 18+. Checks every claim in docs/claims.json live, prints PASS/FAIL per claim
node judge/verify-claims.mjs --only contract-code-hash   # one claim
node judge/verify-claims.mjs --offline                   # file checks only
```

[`docs/claims.json`](docs/claims.json) lists each factual claim made in `README.md`, `TRACK_COVERAGE.md`, `SECURITY.md` and on the live site, with the file and line that states it, the evidence type (mainnet tx, mainnet view, OutLayer call, test file, CI run, script, file, live site), the evidence link or path, the command that checks it, and the expected output.

What the script reads, all public and read-only:

| Source | Used for |
|---|---|
| NEAR mainnet RPC (`archival-rpc.mainnet.fastnear.com`, override with `NEAR_RPC`) | contract `code_hash`, `config`, `nft_total_supply`, token owners and tiers, access keys and their scopes, every linked transaction |
| `api.outlayer.ai/attestations/by-call/<id>` | each linked enclave call: TDX quote present, `executed_wasm_sha256 == wasm_hash`, the claimed build and project |
| `main.fastfs.io` | the published worker wasm hashes to `tee/worker/DEPLOYED_SHA256` |
| `keyhole-seven.vercel.app` | pages serve, security headers, home supply and heartbeats equal the chain |
| GitHub API | linked CI runs concluded `success` (shown as SKIP while the repository is private) |
| this repository | linked paths exist, named tests and constants exist in the source, committed wasm sha256 |

Values that change over time (token supply, heartbeat count, beat-key gas allowance, token owners) are stated with their capture date in the docs; the script prints the live value and checks it against the dated claim (`>=` where the value only grows).

## Deeper checks

| Command | Proves |
|---|---|
| `./judge/1-contract.sh` | on-chain contract code equals `contracts/keys/deployed/keyhole_keys.wasm`; the minter is the TEE-held implicit account |
| `./judge/2-attestations.sh` | each recorded call in `judge/evidence.json` ran the attested build and its published output hashes to the attested `output_hash` |
| `./verify.sh b0a6eadb-cee9-400e-8eca-8b0f4df7bcec --rebuild` | rebuild the worker from source with the pinned toolchain; its sha256 equals what the enclave executed |
| [keyhole-seven.vercel.app/verify](https://keyhole-seven.vercel.app/verify) | the same attestation checks plus Intel DCAP and Intel PCS, computed in your browser |
| [keyhole-seven.vercel.app/judge](https://keyhole-seven.vercel.app/judge) | six guided mainnet checks: build identity, contract identity, transfer moves control, holder limits, cooldown, tier caps |

Regenerate the claim list after editing the docs: `python3 judge/gen-claims.py .` (CI checks that every entry is well formed and that each referenced path exists: `web/tests/claims.test.ts`).
