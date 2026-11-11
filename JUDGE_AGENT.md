# Verify KEYHOLE

Start at [VERIFY.md](VERIFY.md). That page is the short path: the generated immutable checkout in [README.md](README.md#1-verify-in-5-minutes-zero-install), then `bash judge/0-live.sh`.

`judge/0-live.sh` needs `curl`, `bash` and `python3`. It compares the live contract `code_hash` with [`identity.json`](identity.json), reads `config`, `contract_source_metadata` and `nft_total_supply`, re-fetches the recorded worker `info` attestation, and checks one recorded mainnet refusal receipt. It also reads `identity.governance` for the owner, lending and the key count recorded there. It does not guess a branch. If this directory has no `identity.json`, set `IDENTITY_JSON` or `IDENTITY_URL` to that same commit.

In a browser: [the verifier](https://keyhole-seven.vercel.app/verify) and [the judge path](https://keyhole-seven.vercel.app/judge).

The source tarball on the site is `git archive` of the pinned commit:

```bash
curl -fsSLO https://keyhole-seven.vercel.app/source/keyhole-src.tar.gz
curl -fsSLO https://keyhole-seven.vercel.app/source/keyhole-src.tar.gz.sha256
sha256sum -c keyhole-src.tar.gz.sha256
zcat keyhole-src.tar.gz | git get-tar-commit-id
tar xzf keyhole-src.tar.gz && cd keyhole
```

`./judge/1-contract.sh` checks that the committed deployed contract wasm hashes to the on-chain `code_hash`. `./verify.sh <call_id>` checks that call's attestation. `./verify.sh <call_id> --rebuild` matches `executed_wasm_sha256` on the commit that published that wasm.

```bash
node judge/verify-claims.mjs
node judge/verify-claims.mjs --only contract-code-hash
node judge/verify-claims.mjs --offline
```

[`docs/claims.json`](docs/claims.json) lists each factual claim in `README.md`, `TRACK_COVERAGE.md`, `SECURITY.md` and on the live site.

| Source | Used for |
|---|---|
| NEAR mainnet RPC | contract `code_hash`, `config`, `nft_total_supply`, token owners and tiers, access keys, linked transactions |
| `api.outlayer.ai/attestations/by-call/<id>` | each linked enclave call |
| `main.fastfs.io` | the published worker wasm |
| `keyhole-seven.vercel.app` | pages, headers, home supply |
| this repository | linked paths, named tests, committed wasm |

| Command | Proves |
|---|---|
| `./judge/0-live.sh` | live `code_hash`, config, metadata, supply, one attested info call, one recorded refusal. No wallet |
| `./judge/1-contract.sh` | on-chain contract code equals `contracts/keys/deployed/keyhole_keys.wasm` |
| `./judge/2-attestations.sh` | each recorded call in `judge/evidence.json` |
| `./verify.sh` with the info call in `identity.json` | attestation and FastFS bytes for that call |
| [keyhole-seven.vercel.app/verify](https://keyhole-seven.vercel.app/verify) | attestation checks plus Intel DCAP and Intel PCS, in the browser |
| [keyhole-seven.vercel.app/judge](https://keyhole-seven.vercel.app/judge) | the guided mainnet checks on the judge page |

`judge/live.mts` and `judge/4-live-refusals.sh` are opt-in. They can spend a signature or mint. They are not this page. Set `KEYHOLE_LIVE_OPT_IN=1` only when you mean to run them.

Regenerate the claim list after editing the docs: `python3 judge/gen-claims.py .`
