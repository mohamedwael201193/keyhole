# Security review with a NEAR AI Cloud TEE model (two passes)

**Model:** `deepseek-ai/DeepSeek-V4.1-Flash-1017-abliterated` on NEAR AI Cloud, listed as `verifiable: true` and described by NEAR AI as abliterated "for red teaming, security research and evaluations". Run on 2026-11-02 (Cairo, UTC+2), temperature 0, against commit `67ce93b`.
Files reviewed: `contracts/keys/src/lib.rs`, `tee/worker/src/lib.rs`, `tee/worker/src/main.rs`, `web/app/api/{ai,oneclick,worker}/route.ts`, `web/lib/gateway.ts`. Script: [`run.mts`](run.mts) (reads the API key from the environment; nothing secret is stored here).

## Attestation of each reply (same checks as /ask)

| Pass | chat id | signed by | request hash | response hash | signature recovers signer | signer + fresh nonce in TDX report_data | Intel DCAP (in-browser lib) |
|---|---|---|---|---|---|---|---|
| 1 | `chatcmpl-50cb7cbe…a069` | NEAR AI gateway TEE `0xb98a…e779` | ✓ | ✓ | ✓ | ✓ | 19/19 |
| 2 | `chatcmpl-8192db60…7a3` | NEAR AI gateway TEE `0xb98a…e779` | ✓ | ✓ | ✓ | ✓ | 19/19 |

Raw: [`pass1.signature.json`](pass1.signature.json), [`pass1.attestation.json`](pass1.attestation.json), [`pass2.signature.json`](pass2.signature.json), [`pass2.attestation.json`](pass2.attestation.json). Prompts: [`pass1.prompt.txt`](pass1.prompt.txt), [`pass2.prompt.txt`](pass2.prompt.txt). Raw output: [`pass1.md`](pass1.md), [`pass2.md`](pass2.md).

How it ran: both passes got the full source. The model wrote its findings in its reasoning stream and ran out of output tokens before a final list, so the raw files are that reasoning. Pass 2 therefore did not receive pass 1's list and acted as a second, independent pass. Every finding below was checked by hand against the code.

## Triage

| ID | Finding (pass) | Verdict | Action |
|---|---|---|---|
| R1 | A new holder can skip the 10-minute withdraw cooldown: a swap, deposit, lock or limits call appends a log row under the new owner, so `prov_sync_owner` never writes the `transfer` row that `cooldown_until` needs (pass 1) | **Real, medium** | Fixed: every write records the change of hands first (`append_synced`). Tests `r1_*` in [`tee/worker/src/tests.rs`](../../../tee/worker/src/tests.rs) |
| R2 | If the ownership re-check RPC errors after the day's spend is charged, `?` returns early without the refund (pass 1) | **Real, low** (holder's own cap) | Fixed: the refund also runs on an RPC error (`owns(..).and_then(settle_if_owner)`) |
| R3 | After 90 s of polling a still-pending wallet request is treated as not-success and its spend is refunded, though it may still settle (pass 1) | **Real, medium** (cap bypass by timing) | Fixed: refund only on `failed`/`error`/`refunded` (`cap_refund_on`). Test `r3_*` |
| R4 | Wallet polling (90 s) outlasts the web gateway timeout (55 s); the user sees an error for a send that still runs and may sign it again (pass 1) | **Real, medium** | Fixed: 15 polls × 3 s. Tests `r4_*` (Rust) and the drift guard in [`web/tests/gateway.test.ts`](../../../web/tests/gateway.test.ts) |
| R5 | Limits use the holder's best tier, so with a Gold and a Bronze key the Bronze key's account trades at Gold caps (both passes) | Real, low; design choice | No change: only Bronze is mintable; recorded as scope in [`SECURITY.md`](../../../SECURITY.md) |
| R6 | A swap signed by the old owner can still run if the transfer is not yet final when the enclave re-reads ownership (pass 2) | Real, low | Scope note: value stays in the account; withdraws keep the cooldown. In SECURITY.md |
| F1 | `nft_payout` `balance * bps` can overflow (both) | False positive | `overflow-checks = true` in the contract release profile, so it panics |
| F2 | `copy` is missing from the web gateway allowlist (pass 2) | By design | Copy-trading is the CLI; `gateway.test.ts` asserts `copy` is refused |
| F3 | `provenance` is public and can write a `transfer` row (pass 2) | Already covered | Idempotent per change of owner; it only starts the cooldown earlier |
| F4 | Withdraw `to` must equal the signer, so a NEAR account cannot withdraw to another chain (both) | By design | Invariant "who can be paid"; refusal `wrong_recipient` proven on mainnet |
| F5 | `/api/ai` does not itself compare the signature address with the attested one (pass 2) | Already covered | The browser does (`signatureValid`, `signerInQuote` in `web/lib/ai.ts`, tests in `web/tests/ai.test.ts`) |
| F6 | Two concurrent mints read the same minter nonce (pass 2) | Real, low | One tx is rejected by the chain; no double mint is possible (token id is derived from the account) |

The worker fixes are in source with tests; they go live with the next worker publish, which will be linked here.
