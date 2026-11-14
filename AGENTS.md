# Verify KEYHOLE

Start at [VERIFY.md](VERIFY.md). That page is the short path: the generated immutable checkout in [README.md](README.md#try-it-5-minutes), then `bash verify/0-live.sh`.

`verify/0-live.sh` needs `curl`, `bash` and `python3`. It compares the live contract `code_hash` with [`identity.json`](identity.json), reads `config`, `contract_source_metadata` and `nft_total_supply`, re-fetches the recorded worker `info` attestation, and checks one recorded mainnet refusal receipt. It also reads `identity.governance` for the owner, lending and the key count recorded there. It does not guess a branch. If this directory has no `identity.json`, set `IDENTITY_JSON` or `IDENTITY_URL` to that same commit.

In a browser: [the verifier](https://www.getkeyhole.xyz/verify).

The source tarball on the site is `git archive` of the pinned commit:

```bash
curl -fsSLO https://www.getkeyhole.xyz/source/keyhole-src.tar.gz
curl -fsSLO https://www.getkeyhole.xyz/source/keyhole-src.tar.gz.sha256
sha256sum -c keyhole-src.tar.gz.sha256
zcat keyhole-src.tar.gz | git get-tar-commit-id
tar xzf keyhole-src.tar.gz && cd keyhole
```

`./verify/1-contract.sh` checks that the committed deployed contract wasm hashes to the on-chain `code_hash`. `./verify.sh <call_id>` checks that call's attestation. `./verify.sh <call_id> --rebuild` matches `executed_wasm_sha256` on the commit that published that wasm.

```bash
node verify/verify-claims.mjs
node verify/verify-claims.mjs --only contract-code-hash
node verify/verify-claims.mjs --offline
```

[`docs/claims.json`](docs/claims.json) lists each factual claim in `README.md`, `TRACK_COVERAGE.md`, `SECURITY.md` and on the live site.

| Source | Used for |
|---|---|
| NEAR mainnet RPC | contract `code_hash`, `config`, `nft_total_supply`, token owners and tiers, access keys, linked transactions |
| `api.outlayer.ai/attestations/by-call/<id>` | each linked enclave call |
| `main.fastfs.io` | the published worker wasm |
| `www.getkeyhole.xyz` | pages, headers, home supply |
| this repository | linked paths, named tests, committed wasm |

| Command | Proves |
|---|---|
| `./verify/0-live.sh` | live `code_hash`, config, metadata, supply, one attested info call, one recorded refusal. No wallet |
| `./verify/1-contract.sh` | on-chain contract code equals `contracts/keys/deployed/keyhole_keys.wasm` |
| `./verify/2-attestations.sh` | each recorded call in the evidence list |
| `./verify.sh` with the info call in `identity.json` | attestation and FastFS bytes for that call |
| [www.getkeyhole.xyz/verify](https://www.getkeyhole.xyz/verify) | attestation checks plus Intel DCAP and Intel PCS, in the browser |

The scripts in `verify/` are thin wrappers for the implementation scripts (same checks, same
output). The opt-in scripts `live.mts` and `4-live-refusals.sh` can spend a signature or mint.
They are not this page. Set `KEYHOLE_LIVE_OPT_IN=1` only when you mean to run them.

Regenerate the claim list after editing the docs: `python3 verify/gen-claims.py .`

## Offline checks (no network)

```bash
node verify/verify-claims.mjs --offline   # 0 FAIL expected; skips are live checks
```

## Online checks (read-only)

```bash
bash verify/0-live.sh                     # live code hash, views, one existing attestation, one FINAL receipt
bash verify/1-contract.sh --strict        # committed live bytes == chain
bash verify/2-attestations.sh             # every recorded call: attested build and output hash
```

## RPC views used by the checks

`nft_total_supply`, `governance_state`, `config`, `view_access_key_list`.

## Expected live facts

Contract v2.7.0, code hash `3cZsaySY…KGZH`, worker `5c786666…`, supply 9, lending off.
