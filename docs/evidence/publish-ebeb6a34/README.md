# Worker build ebeb6a34 (wallet-signed withdraw, swap floor, refunds, nonce pruning)

- Source: main 59801c1 (#134 `fix(worker): wallet-signed withdraw, slippage floor, refunds on refusal, nonce pruning`).
- Wasm: `ebeb6a3496b9c3e2447cbca12919b33f631931150f6ab7565c525451060f583b` (748021 bytes). The FastFS copy at https://main.fastfs.io/keyhole-devmo.near/outlayer.near/ebeb6a3496b9c3e2447cbca12919b33f631931150f6ab7565c525451060f583b.wasm hashes to this value, and `./verify.sh 5650a6b7-b7de-410c-b206-e189171bad15` prints OK for it.
- FastFS upload: tx [`HSCTERXC…`](https://nearblocks.io/txns/HSCTERXCUv1uEfrcz44pxM5Ltcy4BKXTfZxxtYUTQsc7) (reverts by design, prepaid gas; the bytes are on FastFS as above).
- add_version: [`MG7pGVSN…`](https://nearblocks.io/txns/MG7pGVSNjFDz85yqrAA9stN4yyXECYfYLDmCgYE4gyq) (active).
- Info call on this build: `5650a6b7-b7de-410c-b206-e189171bad15` (attestation 1298844, `executed_wasm_sha256` = `ebeb6a34…583b`, `output_hash` `d81005b5926c748bbd6ee8c7b5110bbb0dfff12696f7bfb905d4198f35036d91`). The published output is in `web/public/evidence/5650a6b7-b7de-410c-b206-e189171bad15.json` and hashes to that `output_hash`. The attestation is in [`attestation_5650a6b7.json`](attestation_5650a6b7.json).
- Previous build: `94c355ff` (add_version [`EA7S1TeV…`](https://nearblocks.io/txns/EA7S1TeVnMF1v5FthV4ffQf9NYXfGJTtzo4ZRp25ZBjy), info call `ecb0d1d6`). Before it: `cff9fd3c`.

## What changed in this build

- **Withdraw needs a wallet signature.** `withdraw` is removed from `SESSION_OPS`. A session token gets `session_scope` for withdraw. The site asks the wallet for a fresh NEP-413 or EIP-191 signature and sends the signed `callbackUrl` only when that signature verifies with it.
- **Swap slippage floor.** A swap sends an explicit `min_amount_out`. When it is absent, the worker derives one from a fresh quote at `DEFAULT_MAX_SLIPPAGE_BPS` (100 bps, 1%). A client value of `0` or a non-integer is refused with `bad_params`. The MCP copy op sends the quote's `minAmountOut`.
- **Refunds on refusal.** A swap or withdraw refused before the send gives back its session budget and its day's spend. A send that fails for good gives both back. A send still pending keeps them (`charge_spend`, `Charge::settle`).
- **Nonce pruning.** Nonce records are deleted 15 minutes after first use (`NONCE_RETAIN_MS` = 3 × `MAX_SKEW_MS`). A replay after that is refused as `expired` by the freshness check.
- **Tests.** `tee/worker/src/worker_hardening.rs` covers the callbackUrl with and without, the mismatch case, the payload encoding, the refund paths, pruning inside and outside the window, and `chain_sign` refusal under a session, lock, cooldown and daily count.
