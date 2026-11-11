# Costs and risk

Figures below are taken from the contract constants and from measured byte prices in the source tests. They are not quotes, not a funding request, and not a claim that lending or protected sales are live. The live contract is **v2.7** in [`identity.json`](../identity.json). The published worker withdraws NEAR only to the current holder. The v2.4 tables further down are historical. Pull-credit handling that an older note called source-only v2.5 is the live v2.7 contract's `claim_payout` path. Lending stays off.

Full caveats, UNKNOWN-callback liveness and release gates live in [SECURITY.md](../SECURITY.md). This page is the fee and risk table a judge can reconcile with the code.

## 1Click fees (conditional)

Source: [NEAR Intents fees](https://docs.near-intents.org/resources/fees), read 11 Nov 2026. These are not one global rate, and they are not an all-in guaranteed fee.

| Request | Extra platform fee |
|---|---|
| Protocol fee on a quote | 0.0001% |
| No API key, and the request is not `ANY_INPUT` | additional 0.25% (25 bps). A submitted `appFees` list stays, plus that 25 bps |
| API key, no `appFees` | normally 0.20% (20 bps). Stablecoin pairs and same-asset multichain: 0.01% |
| API key and `appFees` | partner-dependent |
| `ANY_INPUT` | exempt from those platform fees |

The near-intents.org site distribution fee is not the fee on every API request. The web names `ONECLICK_API_KEY`. The worker names `ONECLICK_JWT`. This page does not print either value.

Storage byte price used for prepaid slots is `env::storage_byte_cost()` (`10^19` yoctoNEAR per byte on current mainnet and in the tested sandbox): 320 bytes = 0.0032 NEAR. If the protocol price changes, `payout_storage_cost()` follows it.

## Historical mainnet (v2.4)

Live delivery is a native push refund on the deployed contract. It is not the candidate's pull-credit `claim_payout` path. The rows below are the deployed v2.4 behavior. Current `contracts/keys/src/lib.rs` is the v2.5 candidate; do not read it as the live refund path. Proof of what is deployed: [contract v2.4 evidence](evidence/contract-v2-4/README.md), [identity.json](../identity.json), and [`contracts/keys/deployed/keyhole_keys.wasm`](../contracts/keys/deployed/keyhole_keys.wasm).

| Action | Constant | Amount | Refundable? | Source |
|---|---|---|---|---|
| List a key (`nft_list`) | `LIST_STORAGE_DEPOSIT` | 0.01 NEAR (attach at least this; excess is a native push refund) | Yes, when the listing ends, to the seller, as a native refund | [v2.4 evidence](evidence/contract-v2-4/README.md) |
| Buy a listed key (`nft_buy`) | price + `royalty_bps` | The attached deposit must cover the price. Live `config.royalty_bps` is **500** (5%), cap 1000. Excess over the price is a native push refund | Listing deposit returns to the seller with the proceeds, as a native refund | [v2.4 evidence](evidence/contract-v2-4/README.md) |
| Change list price, unlist, `set_minter`, `set_royalty` | 1 yoctoNEAR | 1 yocto | — | [v2.4 evidence](evidence/contract-v2-4/README.md) |
| Minimum list price | `MIN_LIST_PRICE` | 0.1 NEAR | — | [v2.4 evidence](evidence/contract-v2-4/README.md) |
| Mint | storage for the token | Paid by the TEE minter; excess is a native push refund | — | [v2.4 evidence](evidence/contract-v2-4/README.md) |

A v2.4 built-in sale pays 5% to `config.treasury` (`keyhole-devmo.near`) and the rest to the seller. That live rate is not the candidate's optional zero-royalty setting.

### Code storage, live and candidate

Measured in [candidate identity](../contracts/keys/release/v2.5/identity.json). Not an all-in top-up. Migration state, gas, the 0.1 NEAR operating reserve, and existing liabilities are outside this table.

| | Live v2.4 | Candidate v2.5 | Proof |
|---|---:|---:|---|
| Code bytes | 241,621 | 485,855 | [identity.json](../identity.json), [candidate identity](../contracts/keys/release/v2.5/identity.json) |
| Code storage at 10^19 yoctoNEAR/byte | 2.41621 NEAR | 4.85855 NEAR | same records |
| Increment over live code | — | 244,234 bytes / 2.44234 NEAR | [measured size record](evidence/integration-stack/contract-size.md) |

## Candidate (v2.5, not deployed)

Reconcile these with [`contracts/keys/src/pledge.rs`](../contracts/keys/src/pledge.rs) and [`contracts/keys/src/sale.rs`](../contracts/keys/src/sale.rs).

| Action | Constant | Amount | Refundable? | Source |
|---|---|---|---|---|
| Open a loan (`open_loan`) | `LOAN_STORAGE_DEPOSIT` | **0.009 NEAR**, exact attachment | Yes. It is a locked liability, not a fee and not available principal. Credited back to the borrower after a confirmed return, then pulled with `claim_payout` | `pledge.rs` |
| Bind sealed collateral | `COLLATERAL_STORAGE_DEPOSIT` | **0.02 NEAR** plus the separate policy-store deposit (`attach policy deposit plus 0.02 NEAR permanent binding storage`) | The 0.02 NEAR is credited back if registration fails. On success it pays permanent binding storage | `pledge.rs` |
| Open a protected sale | `SALE_STORAGE_BOND` | **0.02 NEAR**, exact attachment | Yes, after verified thaw, as pull credit to the original seller. It is not a storage charge or operating capital | `sale.rs` |
| Register a payout account | `PAYOUT_STORAGE_BYTES` × `storage_byte_cost()` | **320 bytes**, 0.0032 NEAR at the tested byte price, exact attachment | **No.** Permanent reusable slot. Duplicate, under- or over-payment rejects atomically without erasing credit | `pledge.rs` (`payout_storage_cost`, `register_payout_account`) |
| Claim a native credit (`claim_payout`) | 1 yoctoNEAR | 1 yocto | Credit itself is pulled; a definite failed payout restores it once; a lost callback stays pending | `pledge.rs` |
| Built-in `nft_list` (still present) | `LIST_STORAGE_DEPOSIT` | 0.01 NEAR | Yes, when the listing ends | `lib.rs` |
| Contract operating reserve | `OPERATING_RESERVE` | 0.1 NEAR | Infrastructure, not a user fee | `pledge.rs` |

`adopt_zero_royalty` is an explicit owner-authorized method on the candidate. At zero, NEP-199 returns the entire declared balance to the seller. Zero royalty is a release setting, not an immutable promise.

### Loan terms in the contract versus the reviewed plan

The contract does **not** hard-code a 7200-second term. It accepts `duration_sec` in `1..=MAX_DURATION` (30 days) and `grace_sec` in `0..=7` days (`pledge.rs`). Debt starts only when the exact principal cashout's genuine successful native callback is observed: funding leaves `due_ns = 0` in `DisbursementPending`. A failed delivery restores credit and starts no debt. A lost callback starts no debt and stays locked.

The reviewed team / offline plan uses a **7200-second term plus 900-second grace**. At principal 0.01 NEAR, the refundable 0.009 NEAR bond plus a first-time 0.0032 NEAR borrower slot makes net incremental liquidity **−0.0022 NEAR before gas and other costs**. That is a mechanism pilot, not a gas-bootstrap or adoption proof. Measured attachments for the planned tiny runs are in [`docs/pledge/TEAM_RUNBOOK.md`](pledge/TEAM_RUNBOOK.md).

One custody command at a time: a lost action callback stays `UNKNOWN` and locked. A Boolean view or a timer cannot clear it. Withdrawals in the candidate go only to the current holder, as a NEAR account on NEAR.

## What a sealed-floor attestation proves, and what it does not

A verified loan certificate (`KEYHOLE_SEALED_LOAN_V3_DELIVERY`) is a signed statement by the pinned attestor that, at `observed_at_ns`, the bound custody wallet met a **raw USDC minimum**, and that the certificate binds the wallet, policy, holder, epoch, nonce, exact terms, network, contract and expiry. Validity is at most 60 seconds and must not be future-dated. An unsigned template is not proof ([`protocol/README.md`](../protocol/README.md)).

It does **not** prove:

- the USD value of the account, NEAR/USDC price, or that USDC stays pegged (there is no price oracle)
- that the floor covers the debt, or any surplus above the floor (default takes the **whole** confidential account, including later deposits; there is no automatic surplus return)
- solvency, demand, profit, or that recovery will succeed on a supported route
- live Intel measurement verification or a ZK balance proof — it is a trusted-attestor statement checked against on-chain fields
- that new swaps or withdrawals cannot already be in flight from earlier signatures (ordinary worker routes refuse new ones during a pledge; pre-existing orders are a separate risk, see SECURITY.md)

Lender risk is therefore the residual vault, route, callback-liveness and operator-key risk, not “floor minus principal”.

## Borrowing against a key versus just swapping

| | Swap inside the key's account | Borrow NEAR against a sealed USDC floor (candidate) |
|---|---|---|
| What you keep | You sell the asset. You do not keep its upside | You keep USDC exposure and receive NEAR liquidity |
| Cost | Swap slippage and any intent / route fee, inside tier caps | Refundable 0.009 NEAR bond, optional first-time 0.0032 NEAR payout slot, repayment ≥ principal, gas, custody freeze/thaw |
| Failure mode | A definite refused swap does not send funds. A lost post-send callback is `UNKNOWN`, not a silent rollback | Default can forfeit the **entire** vault, not only the disclosed minimum. UNKNOWN cashout or policy callback stays locked |
| Privacy | The solver sees the pair and amount of that quote | The exact balance stays sealed; only the minimum is certified, and only at observation time |
| When it is live | Swaps are live on mainnet, with attested refusals and tiny successful trades in the README evidence | **Not live.** Preview UI is flag-off. Do not treat the dashboard as a funded loan |

Swapping is often simpler and cheaper. Pledge is bilateral short NEAR liquidity while retaining USDC exposure, with a larger loss surface. Neither path is a yield guarantee.
