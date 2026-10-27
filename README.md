# KEYHOLE

**An NFT that is the viewing key to a confidential trading account.** The account lives inside a TEE (OutLayer, Intel TDX). Only the key holder can open it, and every answer comes with an attestation of the exact code that ran.

Works for any NEAR account, anywhere. No sign-up, no email, no region lock.

## Get started (3 steps)

1. **Have a NEAR account.** Any wallet that supports NEP-413 `signMessage` works (for example MyNearWallet, Meteor, HERE, Intear, Sender, Ledger via a supported wallet).
2. **Mint your key.** Sign one message (`op: "mint"`). The TEE mints a Bronze key to your account. Free, one per account.
3. **Use it.** Sign a request (`status`, `quote`). The TEE checks your signature, your key and your limits, then answers privately.

Nothing to install. Signing a message costs no gas.

## What's live (NEAR mainnet)

| piece | where |
|---|---|
| Keys NFT contract (NEP-171/177/181/199) | [`keyhole-devmo.near`](https://nearblocks.io/address/keyhole-devmo.near) |
| TEE worker (OutLayer project) | `keyhole-devmo.near/keyhole`, build `f13efe92…119c` (reproducible) |
| TEE-held minter | [`015a0259…c443`](https://nearblocks.io/address/015a025906a59f9f40ca17daf2a3c61c5e63a37c081c75230870caa6a82ac443) (key generated inside the enclave) |

## Safety by design

- **Your signature, checked in the enclave.** NEP-413, bound to the app (`recipient: keyhole`), with a one-time nonce and a 5-minute window. Replays are refused.
- **Hard caps you can't overrun.** Per-trade and daily limits per key tier, priced from the solver quote. Over-cap requests are refused with an attested receipt.
- **Rate limits** per holder and globally.
- **Per-holder state.** Each account's data is isolated in encrypted storage.
- **Verifiable.** `sha256(worker.wasm)` must equal `executed_wasm_sha256` in the attestation.

## Repo

- `contracts/keys/`: keys NFT contract (Rust, near-sdk)
- `tee/worker/`: OutLayer TEE worker (Rust, wasm32-wasip2). See its README for the ops, checks and error codes.
- `scripts/sign-and-call.js`: sign a NEP-413 request with a local key and call the worker
- `web/`: the website, live at https://keyhole-seven.vercel.app (Next.js, wallet selector, TEE gateway). See [web/README.md](web/README.md)
- `docs/FRONTEND_REQUIREMENTS.md`: requirements for the web app

## License

MIT
