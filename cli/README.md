# keyhole CLI + MCP server

Use KEYHOLE from a terminal or from any MCP-capable AI assistant. Works with any NEAR account.

## Install

```
cd cli && npm ci
npx tsx src/cli.ts help        # or: npm run build && node dist/cli.js help
```

## Auth (your key never leaves your machine; only signatures are sent)

- `KEYHOLE_ACCOUNT` + `KEYHOLE_PRIVATE_KEY` (`ed25519:...`), or
- `KEYHOLE_KEY_FILE` / `--key-file` (JSON `{account_id, private_key}`), or
- near-cli login: `~/.near-credentials/mainnet/<account>.json` with `KEYHOLE_ACCOUNT`.

The key must be a **full-access** key of the account (the TEE checks it on-chain).

## Route

- `KEYHOLE_GATEWAY`: a hosted endpoint accepting `POST {op, auth}` and returning the worker reply (the website provides one).
- `OUTLAYER_PAYMENT_KEY`: call OutLayer directly with your own payment key.
- Optional: `KEYHOLE_PROJECT` (default `keyhole-devmo.near/keyhole`), `KEYHOLE_RECIPIENT` (default `keyhole`).

## Commands

| command | does |
|---|---|
| `info` | worker version, limits, minter |
| `mint` | free Bronze key, one per account |
| `status` | tier, limits, today's spend |
| `quote --amount N [--from ID --to ID] [--mode basic\|advanced] [--execute]` | confidential 1Click quote within caps |
| `account [--chain base --amount N]` | your confidential id, optional cross-chain deposit address |
| `balance` | confidential balances |
| `swap --amount N [--from ID --to ID]` | confidential swap within caps |
| `history`, `pnl` | your private log, plain-language summary |
| `withdraw --chain near --to you.near --token ID --amount N` | move funds out |
| `verify <call_id> [--wasm file]` | attestation vs FastFS (and your build) |

Amounts are in base units (USDC: 6 decimals, so `10000` = 0.01 USDC).

## MCP

```json
{ "mcpServers": { "keyhole": { "command": "npx", "args": ["tsx", "/path/to/keyhole/cli/src/mcp.ts"],
  "env": { "KEYHOLE_KEY_FILE": "/path/key.json", "KEYHOLE_GATEWAY": "https://…/api/keyhole" } } } }
```

Tools: `verify`, `explain_pnl`, `quote_buy`, `copy`. `copy` is two steps: the first call returns a preview and a `confirm_code`. The trade runs only when called again with that code (single use, 5 minutes). Assistants must show the preview and get an explicit yes first.

## Interface for apps (stable)

`src/core.ts` exports `signRequest(key, op, params)`, `callWorker({op, auth})`, `verifyCall(callId, wasmPath?)`, `explainPnl(history, balances)`, `nep413Bytes()`. A browser wallet produces the same `auth` with NEP-413 `signMessage({message, recipient: "keyhole", nonce})`, where `message = JSON.stringify({op, account_id, ts_ms, params})`.
