# Exact NEAR USDC exit — source candidate, not live proof

Credit: devmo. No wallet operation, real signing, publication or secret change was
performed by this implementation. Contract, UUID, sealed namespace, immutable
minter/attestor and payment-key nonce-2 wrapper are unchanged.

## Authoritative API sources and exact wire shapes

Read the [Getting Started index](https://app.outlayer.ai/docs/getting-started) and
[Agent Custody guide](https://app.outlayer.ai/docs/agent-custody), sections **7.
Withdraw**, **Confidential Intents**, **Policy Engine**, and **API Reference**.
Exact response definitions are the official [OpenAPI](https://api.outlayer.ai/openapi.json),
version `0.1.0-alpha.4`, full-spec SHA256
`56a4ab8b3f8c5d708b9ef5785da2ff035ffc1ca192505b00e7c80b3fb6948e39`.
The [schema snapshot](outlayer-exact-exit-schemas.json) preserves definitions.

Base: `https://api.outlayer.ai`. Each POST uses wallet Bearer authentication,
`Content-Type: application/json`, and a distinct immutable `X-Idempotency-Key`.
The wallet credential is sealed; it is not the execution payment key.

| Hop | Endpoint | Exact JSON sent |
|---|---|---|
| Unshield | `POST /wallet/v1/confidential/unshield` | `{ "token": "nep141:<canonical-USDC-contract>", "amount": "<signed-amount>" }` |
| Register receiver | `POST /wallet/v1/storage-deposit` | `{ "token": "<bare-canonical-USDC-contract>", "account_id": "<current-holder>" }` |
| Exact FT exit | `POST /wallet/v1/intents/withdraw` | `{ "chain": "near", "to": "<current-holder>", "amount": "<signed-amount>", "token": "nep141:<canonical-USDC-contract>", "async": true }` |

Canonical contract is
`17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`.
No `min_amount_out`, quote ID, deadline or guessed field is sent to these APIs.
Those are signed KEYHOLE constraints, not undocumented provider parameters.

- `ConfidentialUnshieldRequest` inherits `IntentsDepositRequest` (`token`, `amount`).
  `ConfidentialOpResponse` requires UUID `request_id` and `status`; optional
  `intent_hash`, `deposit_address`, approval fields and `poll_url` are not delivery
  proof. Poll `/wallet/v1/requests/{request_id}`, type **confidential**.
- `StorageDepositResponse` requires `request_id`, `status`, `token`, `account_id`,
  `already_registered`; nullable `tx_hash` and approval fields are possible.
  The endpoint prose and schema disagree about multisig support: treat an approval
  as pending, never auto-approve or assume it signed. Poll type **call**, then
  independently require FINAL `storage_balance_of` registration.
- `WithdrawRequest` documents `chain`, `to`, `amount`, `token`, `async`.
  `WithdrawResponse` requires `request_id`, `status`; optional approval/poll fields.
  Poll type **withdraw**. Same-chain success has `result.intent_hash` and
  `result.delivered = nep141:<contract>`, NOT `tx_hash`, amount, or an invented receipt.
  No Intents identifier is displayed as a chain transaction.

Detailed official references:
[confidential](https://skills.outlayer.ai/agent-custody/references/confidential.md),
[storage](https://skills.outlayer.ai/agent-custody/references/wallet-ops.md),
[withdraw/status/idempotency](https://skills.outlayer.ai/agent-custody/references/intents-withdraw.md).
No broad `completed` synonyms are accepted for unshield/withdraw; storage uses the
call response's documented statuses. HTTP-200 error envelopes are errors except a
correctly bound `duplicate_idempotency_key`, which still requires a fresh GET.

## Protocol and recovery

Holder signs `exit_mode: exact-near-v1`, canonical USDC, `chain: near`, exact self
recipient, positive decimal `amount == min_amount_out`, current token/owner epoch,
and a deadline at most five minutes ahead. Only fresh full-access NEP-413 is
accepted. The amount in every hop is exactly this immutable policy-bound amount.
The borrower after repayment, or the actual new holder after default and cooldown,
is the sole allowlisted recipient; this is not authority to pay an arbitrary lender.

One native value permit and spend reservation protect all three hops. Current
owner/epoch, no pledge/listing/provisional transfer, seller lock, ten-minute
cooldown, canonical wallet, singleton registry and enrollment are rechecked.
For each hop, persist baseline, exact request/path/key, atomic dispatch claim,
original provider ID, terminal GET and verified readback. Only one POST claimant
exists. Any lost ID/POST reply is UNKNOWN with NO retransmission, even under the
same key; known IDs recover by GET only. Reconciliation can start the next,
previously unsent hop only under the original unexpired signed plan and all gates.
An expired plan cannot dispatch a later hop. Never create a replacement/top-up.

Before registration require terminal original unshield success, private debit
**exactly amount**, and public Intents self-credit **exactly amount**. Public
`mt_balance_of` on `intents.near` must agree with authenticated executor-identified
OutLayer balance. Before FT withdrawal recheck both balances, amount and FINAL
recipient registration. After withdrawal require original success/canonical
`delivered`/intent ID, FINAL recipient `ft_balance_of` increase **exactly amount**,
Intents decrease **exactly amount**, and unchanged private balance. No mismatch
releases admission or appends successful history. A terminal unshield refund/failure
can finish failed only with full original private/public balances restored; caps
are conservatively retained. Other partial failures retain unresolved admission.

## Policy, cost, privacy and honest scope

Fresh reviewed confinement policy adds `withdraw` and `call` transaction types.
`withdraw` is worker-controlled/excluded from routine quorum; **call is NOT
excluded** and needs guardian approval. The worker exposes only typed storage, not
an arbitrary call operation. Raw/EVM/Solana/message signing, Intents calls,
external keys, payment checks and resting orders stay denied. Already enrolled
old policies are not silently upgraded: exact decrypted readback/auditor review
must approve the new policy before use. Recipient registration can be pre-existing;
otherwise fund the wallet's own native reserve and obtain the required approval.

Storage minimum must be positive and at most 0.00125 NEAR. Reserve 0.0025 NEAR per
exit for storage/gas; actual observed native debit must not exceed it. Include both
exit admission maxima (0.01 NEAR each), compute/polling and existing completion/OFF
reserves in the unchanged 0.4 NEAR / 0.999 USDC-equivalent / 0.00005 Base-ETH gates.
Never assume the old ~0.383 estimate covers the larger flow. A failed budget is STOP.

Unshield links the custody wallet, amount and asset on the public chain. This is an
explicit three-hop product path, not an invisible substitution or a confidential
withdrawal with synthetic minimum enforcement. Unshield liquidity, fees, refund
semantics and measured provider enforcement remain provider/solver assumptions.
A short unshield stops before external payment but may leave public funds/fees;
postchecks do not roll back the first hop. Local tests cannot prove a future fill.

Delivery evidence is labelled **FINAL balance deltas + original provider ID**, not
a transaction-receipt proof. Balance reads are sequential, not atomic; unrelated
recipient activity can make them ambiguous or coincidentally match. The typed
same-chain operation and provider identity remain trusted. This is not cryptographic
causal attribution of every incoming unit. Live acceptance should additionally
capture a genuine original FT receipt when available; never invent a tx hash.
Missing/malformed provider/RPC/readback data fails closed. Testnet has no Intents
solvers; sandbox uses real native admission/title receipts with explicit custody
ledger mocks, not a live confidential shard/keystore proof.
