# Live NEP-178 sale via direct approval — mainnet (13 Nov 2026)

KEYHOLE demonstrated the full NEP-178 approval lifecycle on NEAR mainnet, on a live
token, with a real on-chain payment. No contract change was needed: the deployed
contract already implements NEP-178 (`nft_approve`, `nft_revoke`, `nft_revoke_all`,
`nft_is_approved`), declared in its own `contract_source_metadata` (nep178 1.0.0).

The buyer is a fresh separate account created and funded (0.3 NEAR) by the project
(keyhole-devmo.near); the seller is a project test holder (TEST_HOLDER2). There was
no listing and no marketplace contract: the sale demonstrates the NEP-178 sale
mechanism (approve → pay → approved transfer → revoke) with a real on-chain payment
at a nominal 0.1 NEAR price.

## What was sold

- **Token:** `k5f4750858f328940` — "KEYHOLE Key · Bronze" (the standard Bronze title and
  description: "Viewing key to a confidential account. Holder-only, attested in a TEE.")
- **Seller:** `3bde8ce5eb4e15403d49ba9512a98070db68958b39f378816f7862cee6168447`
- **Buyer:** `456dbde9d96a87444db1f11335adfecd72eb395c59eb7cec0942ccb1623e2a0c`
  (a fresh separate account created for this sale)
- **Price:** 0.1 NEAR (nominal, demonstration-scale), paid on-chain by the buyer to the seller before the transfer.
- **Result:** the token's owner is now the buyer; all approvals are cleared.

## The four steps (five transactions, all FINAL, all on mainnet)

| Step | Call | Transaction |
|---|---|---|
| 1. Approve | seller `nft_approve(token, buyer)` | `6auA8cm2GfCvvBP1HyxFq7iwD74a6qi3dVQBZ6xmPsvH` |
| 2. Pay | buyer pays 0.1 NEAR to seller (plain transfer) | `4xfCSX7Pzq7GUxiW9PvqAryxNniBzFAEcwJBPSxkuueq` |
| 3. Transfer | buyer `nft_transfer(receiver=buyer, token, approval_id=3)` | `F52PyT43rVizWmkcJVxbcKuj7n3KZFK5GQsNyuiXY2iT` |
| 4. Revoke | buyer `nft_approve(token, seller)` then `nft_revoke(token, seller)` | approve `Axq76Hk8UMQou7EXMufVpev4Q7gDj73apxAbZfKC6AoX`, revoke `DuMkpjSMmRgtcyQMxRSQZ3Gg6J627B6NeNoQWTCQt8Jr` |

Setup transactions (also on-chain): seller `register_payout_account`
(`83JmH88kkmC2vo3pzEXCimqZurX5UtkrZXr4E6gB8NFr`), buyer
`register_payout_account` (`9WbFhtzhGv7GrQnrRv1Nt5stn6vjK1JH77vPedaod1Xm`),
buyer funding (`HokBiA2wcrTy8QG7AFWWvYm5xDE8x2ZLXeHmcm9RBUgq`), seller top-up 0.2 NEAR (`DVQ5YBFNBpog9y6ghjjkf8TaxCnK1CqcxAor1ZwZ6313`).

Notes on the run, stated plainly:

- The approval was granted with **approval id 3**, not 1: this token's per-token
  approval counter was already at 3, so two earlier approvals (ids 1–2) had been
  granted and later cleared before this sale. The sale read the live id from
  `nft_token` instead of assuming it.
- Two `nft_approve` attempts by the buyer failed on-chain before the revoke
  demonstration (txs `FykZ6fZqiFWASC9wG7A5TPaW5mWP3wgsMyjo9Hgy5MYJ` and
  `F1ryCVVNf9rGUWq15FyBiGSSy4BuFkYE6JavYwzCcnTB`): the contract requires the token
  owner to hold a payout credit before approving, and the buyer had not registered
  one yet. The buyer registered a payout account and the approval then succeeded.
  No state changed on the failed attempts.
- A fresh mint was not possible at the time: the worker's minter journal is blocked
  until the chain reaches final height 224346890, so the sale used an existing
  non-loan token with the standard Bronze title. A second sale with a fresh mint is
  a separate step once the journal clears.

## Verify it yourself

```bash
# Current owner (should be the buyer) and approvals (should be empty)
curl -s https://rpc.mainnet.near.org -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"t","method":"query","params":{"request_type":"call_function","account_id":"keyhole-devmo.near","method_name":"nft_token","args_base64":"eyJ0b2tlbl9pZCI6Ims1ZjQ3NTA4NThmMzI4OTQwIn0=","finality":"final"}}'

# Any transaction above, e.g. the transfer (sender = buyer account):
curl -s https://rpc.mainnet.near.org -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"t","method":"tx","params":{"tx_hash":"F52PyT43rVizWmkcJVxbcKuj7n3KZFK5GQsNyuiXY2iT","sender_account_id":"456dbde9d96a87444db1f11335adfecd72eb395c59eb7cec0942ccb1623e2a0c","wait_until":"FINAL"}}'
```

Full evidence (every step, every hash, the blocker, and the fallback choice):
the section above; the sale is also row 6 of the [proof table](../README.md#proof).
