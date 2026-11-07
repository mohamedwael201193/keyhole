# Worker build a985fd87 (the #134 hardening without nonce pruning)

- Source: main 6a88871. It is the #134 hardening (wallet-signed withdraw, swap slippage floor, refunds on refused calls) with the nonce pruning removed from the call path (#139, `fix(worker): no nonce pruning on the call path`).
- Wasm: `a985fd87866c4a586603d30f0f73bdff1506e381c5b8a748973302d028b9e4f8` (745180 bytes). The FastFS copy at https://main.fastfs.io/keyhole-devmo.near/outlayer.near/a985fd87866c4a586603d30f0f73bdff1506e381c5b8a748973302d028b9e4f8.wasm hashes to this value. The CI build and a local WSL build of the same source both give this hash.
- FastFS upload: tx [`Bc8YArR3…`](https://nearblocks.io/txns/Bc8YArR3dwjaTY5fVPbqxCVEXf7xp62DkSBuWjuUmdUY) (`__fastdata_fastfs`, reverts by design on prepaid gas; the bytes are on FastFS as above).
- add_version and set_active: tx [`A1o8882h…`](https://nearblocks.io/txns/A1o8882hpjZmBr56hhDop236MrSFtEnMfNt9nEZwo4sG) (active).
- Info call on this build: `246e4a7a-f138-4459-8548-350dd9960751` (attestation 1306951, task 1308282, `executed_wasm_sha256` = `wasm_hash` = `a985fd87…e4f8`, `output_hash` `d81005b5926c748bbd6ee8c7b5110bbb0dfff12696f7bfb905d4198f35036d91`). The published output is in [`web/public/evidence/246e4a7a-f138-4459-8548-350dd9960751.json`](../../../web/public/evidence/246e4a7a-f138-4459-8548-350dd9960751.json), and it hashes to that `output_hash`. The attestation is in [`attestation_246e4a7a.json`](attestation_246e4a7a.json).
- Signed calls on this build (attested, `executed_wasm_sha256` = `a985fd87…e4f8`):
  - status `7532483b-adda-4295-8e45-fe2596bdd5f7` (attestation 1306921)
  - balance `01e50cf9-587a-4610-b5ac-ca356a72cc91` (attestation 1306926)
- Previous active build: `94c355ff` (add_version [`EA7S1TeV…`](https://nearblocks.io/txns/EA7S1TeVnMF1v5FthV4ffQf9NYXfGJTtzo4ZRp25ZBjy), info call `ecb0d1d6`).

## What is live in this build

- **Withdraw needs a wallet signature.** `withdraw` is removed from `SESSION_OPS`. A session token gets `session_scope` for withdraw.
- **Swap slippage floor.** A swap with no `min_amount_out` is floored at 1% below a fresh quote (`DEFAULT_MAX_SLIPPAGE_BPS`). A client value of `0` is refused with `bad_params`.
- **Refunds on refusal.** A swap or withdraw refused before the send gives back its session budget and its day's spend. A send that fails for good gives both back. A send still pending keeps them.
- **callbackUrl in the signed payload** when the wallet signed one.
- **chain_sign** needs a fresh wallet signature, refuses while the key is locked or in the transfer cooldown, and is capped at 5 per key per UTC day.
- **Nonce pruning is not enabled.** Nonce records are kept. `prune_nonces` exists as a helper but no op calls it.

## History of the build line

1. `94c355ff`: active, calls ok.
2. `ebeb6a34`: published with add_version [`MG7pGVSN…`](https://nearblocks.io/txns/MG7pGVSNjFDz85yqrAA9stN4yyXECYfYLDmCgYE4gyq) and info call `5650a6b7` (attestation 1298844). It pruned nonces on the call path. On OutLayer the storage key listing blocked every signed call until the 60-second limit. It was rolled back to `94c355ff` by set_active_version tx [`ArXzjsWP…`](https://nearblocks.io/txns/ArXzjsWPs9ii119Q3zy3dViPERaKF26rE7Q1xnLmZrEW). Its attestations are genuine and verify as a previous build, not the current one. See [publish-ebeb6a34](../publish-ebeb6a34/README.md).
3. `94c355ff`: active again.
4. `a985fd87`: this build. The same hardening as `ebeb6a34` without nonce pruning on the call path (#139).

## Verify

`./verify.sh 246e4a7a-f138-4459-8548-350dd9960751` checks the TDX quote, `wasm_hash == executed`, `executed == published build a985fd87`, and the FastFS bytes. `./verify.sh 246e4a7a-f138-4459-8548-350dd9960751 --rebuild` also compares a local `build.sh`.
