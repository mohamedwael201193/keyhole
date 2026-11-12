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
| `withdraw --to you.near --token USDC --amount N` | move USDC (base units) out to a NEAR account: confidential unshield, then recipient storage registration, then the Intents withdraw; fresh full-access signature; `--exact-near` is accepted and ignored |
| `verify <call_id> [--wasm file]` | attestation vs FastFS (and your build) |

Amounts are in base units (USDC: 6 decimals, so `10000` = 0.01 USDC).

## MCP

```json
{ "mcpServers": { "keyhole": { "command": "npx", "args": ["tsx", "/path/to/keyhole/cli/src/mcp.ts"],
  "env": { "KEYHOLE_KEY_FILE": "/path/key.json", "KEYHOLE_GATEWAY": "https://…/api/keyhole" } } } }
```

Tools: `verify`, `explain_pnl`, `quote_buy`, `copy`. `copy` previews the trade, runs the counterparty check on your own account, and then waits for the operator to type a code shown on the operator's terminal (5 minutes). The code is never part of a tool result, so the assistant cannot confirm for itself. With no operator terminal (for example, when the MCP server is started by a client with no terminal), `copy` is refused.

## Counterparty guard

`withdraw`, `quote --execute` and MCP `copy` check the receiver before signing (`src/counterparty.ts`, rules in the root README, "AI Security & Defense"). `block` refuses and exits 2 without signing. `warn` asks the operator at their terminal (`/dev/tty` on macOS and Linux, `CONIN$` and `CONOUT$` on Windows) and exits 3 if not confirmed. Audit lines go to stderr as JSON with verdicts and reason codes only. Advisory: anyone holding the full-access key can sign without this CLI.

## Interface for apps (stable)

`src/core.ts` exports `signRequest(key, op, params)`, `callWorker({op, auth})`, `verifyCall(callId, wasmPath?)`, `explainPnl(history, balances)`, `nep413Bytes()`. A browser wallet produces the same `auth` with NEP-413 `signMessage({message, recipient: "keyhole", nonce})`, where `message = JSON.stringify({op, account_id, ts_ms, params})`.


### Candidate ownership epochs and payouts

Value requests (swap/copy/withdraw/executed quote) resolve the exact current token and final owner epoch before NEP-413 signing. A stale supplied epoch is refused; do not reuse old signed JSON after a handover.

`keyhole reconcile --key <token_id> --value-op-id <original-ID>` checks the original custody journal with fresh holder authorization. Never create another payment to replace UNKNOWN. The MCP tool exposes the same holder-only reconciliation.

`keyhole payout` reads slot registration, backed credit and pending native payout. First use requires `keyhole payout --register --accept-storage-yocto <exact-read-cost>`: this is a permanent nonrefundable storage purchase, separate from bonds/gas. `keyhole payout --claim` signs one-yocto `claim_payout` to the same account. A hash or successful HTTP response is not native delivery: inspect the FINAL transfer/callback receipts and re-read pending state. UNKNOWN stays locked. A definitive MethodNotFound identifies legacy v2.4; network failures do not downgrade policy.

Before candidate mint rollout, `node scripts/payout-onboarding.mjs [additional-recipient.near ...]` (from repo root) prints a **read-only unsigned** minter/recipient onboarding plan. It never reads credentials or sends transactions. The release operator must separately approve the exact sponsorship fee; the worker refuses unregistered-minter minting before quota/dispatch.

Candidate v2.5 minting also recycles the sealed minter’s backed overpayment credit through `claim_payout`. It never purchases a payout slot automatically, never rolls back a successful mint because cashout is uncertain, and never labels an unverified native delivery paid. A pending cashout is not resubmitted; operator slot onboarding remains an explicitly approved release action.
