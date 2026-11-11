# Exact NEAR exit: local validation, not publication

> Historical pre-R3 snapshot. The corrected source candidate and causal original-FT/continuation proof are recorded in [Round 3 evidence](r3/README.md) and [its bound validation record](r3/validation.json). Do not read the earlier balance-delta result below as the current acceptance criterion.

Credit: devmo. Source pin: `identity.json#/review/source_commit`.
Worker artifact: `ce0a33a67b985eb7952a30493f6f28926e07e7ae57e953a55a20c63d63a42966` (1312726 bytes).
Both actual WASI builds match; the second used a separate target directory.
Contract source/release bytes, UUID, minter/attestor and nonce-2 payment wrapper
were not changed. The short-delay sandbox builder restored the exact release
artifact (`26d3deeff8a4445515d6356097bd7634e8b26deaee7e7ea1ebe47849b807c08c`).

## Current successful local suites

| Suite | Result |
|---|---|
| Worker unit/adapter | 752 pass |
| JavaScript release/worker gates | 180 pass |
| Receipt proofs | 9 pass |
| CLI | 79 pass; TypeScript build passes |
| Web unit | 1976 pass in 112 files; final post-pin rerun retained in handoff |
| Contract unit | 342 pass |
| Native sandbox | 62 pass (28 Pledge + 34 other); one existing opt-in server ignored |
| Browser desktop/mobile | 215 direct pass + 2 passed on retry; 15 existing opt-in skips |
| Clippy | worker native + WASI, contract native, sandbox all-targets pass |
| Web checks | typecheck and lint pass (0 errors; 10 existing warnings); production build passes |

Original raw outputs, diagnostic failures, final post-pin web outputs and the
unpublished candidate WASM remain under `/workspace/handoff/exact-exit`.
Committed logs normalize trailing whitespace and are hashed by validation.json.
The first broader sandbox diagnostic lacked the ignored short-delay fixture;
the existing fixture builder and correct native working directory fixed setup.
The complete broader suite then passed. No test assertion, timeout, production
cap, release byte, skip/ignore or production delay was weakened to obtain it.
The retained funded-browser log is historical native-only evidence, not a rerun
or a new exact-exit/live-provider claim.

## Coverage and limits

The new fault cases include non-filled/refunded unshield, wrong/short/excess self
credit, registered storage and gas reserve, provider envelopes/type/ID errors,
wrong recipient/asset/amount, every-hop partial failure/replay/lost reply, expiry,
persistence crashes, corrupted typed recovery proof and exact FINAL FT deltas.
Real native sandbox admission/title/finish receipts exercise the shared driver
with an explicitly mocked custody ledger. Browser fixtures use the production
preview/consent guard without the former synthetic guard bypass.

Official schemas/sources: [exact protocol](../../../worker/EXACT_NEAR_EXIT.md)
and [snapshot](../../../worker/outlayer-exact-exit-schemas.json). The OpenAPI
snapshot SHA is `56a4ab8b3f8c5d708b9ef5785da2ff035ffc1ca192505b00e7c80b3fb6948e39`.
FINAL balance deltas plus the original provider ID are not cryptographic causal
receipt attribution; sequential reads/concurrent recipient activity and provider
trust remain explicit. No source test proves future liquidity or refunds.

No mainnet or real-wallet signing/transaction, publication, secret change or
custody API POST was performed. Only generated local sandbox identities transact.
Independent integrated-head review, hosted CI, separately approved publication,
fresh reviewed exact policy enrollment (guardian-approved call + withdraw), and
actual original unshield/refund/FT delivery evidence remain release gates.
