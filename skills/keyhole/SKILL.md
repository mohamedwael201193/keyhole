---
name: keyhole
description: Use the KEYHOLE CLI and MCP server to read a confidential trading account behind a NEAR NFT key, request quotes, and verify TEE attestations. Load this when the user wants keyhole, a viewing-key NFT, a confidential quote, or a check that a call ran the published worker.
---

# KEYHOLE

The NFT on `keyhole-devmo.near` is the viewing key. The account itself runs in an OutLayer Intel TDX worker. This skill is the command surface. For how that worker is hosted, deployed, or paid for, read [the OutLayer skill](https://skills.outlayer.ai/outlayer/SKILL.md) and stop there. Do not invent a second path.

Install this skill with `npx skills add mohamedwael201193/keyhole`.

## Safety

- `quote` with no `--execute`, `info`, `status`, `balance`, `history`, `pnl`, and `verify` do not move funds.
- Do not run `swap`, `withdraw`, `quote --execute`, or MCP `copy` unless the user asked for that action and those amounts in this conversation.
- Withdraw, `quote --execute` and `copy` check the receiver first. A `block` refuses before anything is signed (exit 2). A `warn` needs the operator to type a code shown on their own terminal (exit 3 if not confirmed). The code is never printed in a tool result or on stdout or stderr, so do not look for it or ask for it. With no operator terminal, a warn is refused.
- `over_cap_per_tx`, `over_cap_daily`, `replay`, `no_key`, `expired`, `wrong_recipient`, `bad_signature`, and `rate_limited` are the worker's answer. Do not raise the amount, reuse the nonce, or sign for a different recipient to get past them.
- Before trusting a trade log, run `keyhole verify <call_id>` or `./verify.sh <call_id>` and read the `OK` lines. The published worker hash is `tee/worker/DEPLOYED_SHA256`.
- `KEYHOLE_PRIVATE_KEY` stays in the environment or a key file. Do not print it, and do not put it in a commit.

Auth is `KEYHOLE_ACCOUNT` plus `KEYHOLE_PRIVATE_KEY`, or `--key-file`, or near-cli credentials. The route is `KEYHOLE_GATEWAY` or `OUTLAYER_PAYMENT_KEY`. The project id is in `cli/src/core.ts` (`DEFAULTS.project`).

## CLI help

The fence is the command list from `keyhole help`. CI compares it to that output.

```text
keyhole info                                   worker version, limits, minter
keyhole mint                                   mint your free Bronze key (one per account)
keyhole status                                 your tier, limits, today's spend
keyhole quote --amount 50000 [--from USDC_ID --to nep141:wrap.near] [--execute]
keyhole account [--chain base --amount 1000000] your confidential id (+ optional deposit address)
keyhole balance                                confidential balances
keyhole swap --amount 10000 [--from .. --to ..] confidential swap within your caps
keyhole history | pnl                          your private trade log / summary
keyhole withdraw --chain near --to you.near --token <id> --amount <base units>
keyhole payout [--register --accept-storage-yocto <exact cost> | --claim]
keyhole reconcile --key <token_id> --value-op-id <original operation ID>
keyhole verify <call_id> [--wasm path]         check attestation vs FastFS (and your build)
```

`mint` asks the wallet to sign a NEP-413 message. It does not attach gas. One Bronze key per account.

## MCP

`keyhole-mcp` (`cli/src/mcp.ts`) speaks stdio. Tools:

| Tool | What it does |
|---|---|
| `verify` | Attestation versus FastFS for `call_id`. Optional `wasm_path` for a local build |
| `explain_pnl` | Plain-language summary of the holder's private `history` and `balance` |
| `quote_buy` | Confidential quote. No funds move |
| `copy` | Previews, runs the counterparty guard, then needs the operator's code on their terminal |

## Verify

```sh
./verify.sh <call_id>
keyhole verify <call_id>
```

Both fetch `https://api.outlayer.ai/attestations/by-call/<call_id>`. A pass is a TDX quote, `executed_wasm_sha256` equal to `wasm_hash`, and the FastFS bytes hashing to that same value. `./verify.sh <call_id> --rebuild` also runs `tee/worker/build.sh` and compares.
