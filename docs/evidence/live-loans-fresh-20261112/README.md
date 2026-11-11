# Fresh-borrower provisioning — 12 November 2026, Africa/Cairo

Lending stayed OFF. UUID `p000000000000004b` and worker `3ff0bcad704020e2d3beceb322d7e680e48367afb03cd0c421de6f6c1a783377` unchanged. No `new`, `migrate`, `migrate_pledge`, or FullAccess key deletion. No signed transactions or private keys are stored here.

The contract `attestor_public_key` `AVoCWQaln59Ayhfa8qPGHF5jo3wIHHUjCHDKpqgqxEM=` is the minter’s TEE key. It is not the collateral auditor, and its private key is not required locally.

## Reviewer secret

`COLLATERAL_AUDITOR_PUBLIC_KEY` was not present in the last successful secrets merge (only `GUARDED_WORKER_HASH` and `INTENTS_READ_API_KEY` were updated). A new project-held Ed25519 reviewer key was generated (private file local, chmod 600, never committed). Official `outlayer secrets update` merged **only** its public key into profile `default`, preserving existing keys and values.

- Public key (base64 32-byte): `xSuKMVrIJSI2TAoGfnRJ6G95W5XMrFRYBfQZHRAbdmk=`
- Label: project-held reviewer key, separate from the attestor; not independent
- Tx: [`E1AyDsfa3i3o7R3NwTdvPob2p7dSynH9kGsXKPr86GM7`](https://explorer.near.org/transactions/E1AyDsfa3i3o7R3NwTdvPob2p7dSynH9kGsXKPr86GM7) — FINAL `SuccessValue`
- Attached 0.1 NEAR; new storage 0.02071 (was 0.01967); refund 0.09896 NEAR; net ≈ 0.001427 NEAR from `keyhole-devmo.near`

## Fresh borrower

New implicit account `0c086e0918ab2f8b23e943012b9995b7bdc0a8db6bde9b44069c8ad66dbd5f10` (public key `ed25519:oyMAr2ZRSTfhVnsUsPwcnu6fpEJSnWr8k5Pxq8azG5u`). Funded 0.099 NEAR from `keyhole-devmo.near`.

- Tx: [`GzqLAznKsXnb6utqaS6ngyVc7t7Gcjy4mTzKG2drnz2r`](https://explorer.near.org/transactions/GzqLAznKsXnb6utqaS6ngyVc7t7Gcjy4mTzKG2drnz2r) — FINAL `SuccessValue`
- Borrower balance 0.099 NEAR, FullAccess key matches, previously unfunded
- CLI fee 0.0071149895375 NEAR; contract paid 0.1061149895375 NEAR total for this transfer

Predicted token id `ka6ad6993999b8fee` (`k` + sha256(account)[:16]). Not minted.

## Minter payout slot

`register_payout_account` for minter `015a0259…c443`, exact 0.0032 NEAR, signed by test_holder3.

- Tx: [`A9n3UiJdUXLavtJD2pmmjty2bUHjsC8s1PFduuFA95H2`](https://explorer.near.org/transactions/A9n3UiJdUXLavtJD2pmmjty2bUHjsC8s1PFduuFA95H2) — success, `payout_storage_register` paid `3200000000000000000000`, view `payout_account_registered=true`
- test_holder3 spent ≈ 0.0034305 NEAR; the 0.0032 storage deposit sits on the contract

## Mint attempts (original IDs only, not resent)

1. `a58b8c26-930e-427c-822b-9892b2ff3ec5` — completed, `ok=false`, `minter_payout_unregistered` (before the slot was paid). Cost 1010 micro-USD.
2. `418327ee-6691-40d8-b30e-c33020e707fe` — completed, `ok=false`, `rpc_unavailable` / `unexpected RPC view schema`. Cost 1010 micro-USD.

Cause of (2): in the published worker, `rpc_view::decode` requires `nft_token` to be a JSON object. `op_mint` views `nft_token` for the predicted id before sending `nft_mint`. An unminted id returns `null`. Fresh mint therefore cannot succeed on worker `3ff0bcad…3377` until that decoder allows null (as it already does for `get_loan` / `get_collateral_binding`) and the worker is rebuilt and republished. No native `nft_mint` was sent as a workaround.

## Stopped before funding quote

`create_collateral_wallet`, `collateral_candidate`, and `collateral_funding_quote` were not started. There is no Base deposit address. Do not send USDC yet.

## Balances after this step (00:20 Africa/Cairo)

- Contract `keyhole-devmo.near`: 6.75297625186628 NEAR
- Fresh borrower: 0.099 NEAR
- test_holder3: 0.1754948855630295 NEAR
- Minter: 0.0408290473618258 NEAR (unchanged)
- Payment key 2: spent 4036 micro-USD cumulative, available $20.005964
- `lending_enabled`: false
