# Worker build cc8d2fa8 (earned tiers and the key freeze on sale)

- Source: `main` at `d3bb985`, the commit this build was made from. Since the previous build's source (`6a88871`), the worker source gained earned tiers, `level_up` ([#164](https://github.com/mohamedwael201193/keyhole/pull/164), [`tee/worker/src/level.rs`](../../../tee/worker/src/level.rs)) and the freeze on a listed key's account for value moves until the sale or unlisting ([#173](https://github.com/mohamedwael201193/keyhole/pull/173)).
- Wasm: `cc8d2fa8e2e4cc3b05705c5b98ac7eaab0ad119fae1745458a3b733d6270ec4c` (755,751 bytes). `./build.sh` in [`tee/worker`](../../../tee/worker) run on `d3bb985` prints this value, so the build is reproducible from the public source.
- add_version and set active: tx [`Epaz3aMA…`](https://nearblocks.io/txns/Epaz3aMAk1WuLGaMuHKCACvGU981uEr4zUqzyep1zfi6). Signer `keyhole-devmo.near`, receiver `outlayer.near`, method `add_version`, status success, 2026-11-08 23:46 UTC.
- Previous active build: `a985fd87` (add_version [`A1o8882h…`](https://nearblocks.io/txns/A1o8882hpjZmBr56hhDop236MrSFtEnMfNt9nEZwo4sG), info call [`246e4a7a`](https://api.outlayer.ai/attestations/by-call/246e4a7a-f138-4459-8548-350dd9960751)).
- Live `info` call: `f21fbb59-13f7-41f4-a89e-a612cf6bdca5` (attestation 1321952, task 1323292, `executed_wasm_sha256` = `wasm_hash` = `cc8d2fa8…`, `output_hash` `7d7a3d4bfa21e3a9e31b47e365db8556dee716ab7300ae7c4041a6eb4131d28b`). The info output lists `level_up`. The attestation is in [`attestation_f21fbb59.json`](attestation_f21fbb59.json), served as received.
- First signed call on this build: `status`, `b6787f80-339e-4de3-8f6d-dc46898d6e6d` (attestation 1321946, task 1323286, `executed_wasm_sha256` = `wasm_hash` = `cc8d2fa8…`, `output_hash` `118e30b81e356ba34c37475b6d3ac63c4ad6bb2bd28ce2c76974db85011f3d30`, result ok). The attestation is in [`attestation_b6787f80.json`](attestation_b6787f80.json), served as received.

## What is live in this build

- **Earned tiers.** `level_up` reads the settled swaps and volume from the verified log and raises the key's tier on chain through the contract's `nft_set_tier` (contract v2.4, see [`docs/evidence/contract-v2-4`](../contract-v2-4/README.md)). It only raises a tier.
- **Freeze on sale.** A listed key's account cannot make value moves until the sale or the unlisting.
- Everything from the previous build stays: the wallet-signed withdraw, the swap slippage floor, refunds on refused calls, and no nonce pruning on the call path ([`publish-a985fd87`](../publish-a985fd87/README.md)).

## Verify

`./verify.sh f21fbb59-13f7-41f4-a89e-a612cf6bdca5` checks the TDX quote, `wasm_hash == executed`, `executed == published build cc8d2fa8` and the FastFS bytes. `./verify.sh f21fbb59-13f7-41f4-a89e-a612cf6bdca5 --rebuild` also compares a local `build.sh`. The same check on `b6787f80-339e-4de3-8f6d-dc46898d6e6d` gives the same result.

## Not in this folder yet

- The published output of the info call (`web/public/evidence/f21fbb59-13f7-41f4-a89e-a612cf6bdca5.json`) is not here. The attestation API returns only hashes, so the body must be saved from the call output. Until it is, `/verify` cannot match the output of the default call, and the output-hash tests in `web/tests` for that call fail.
