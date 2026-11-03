# Keys contract v2 on mainnet (2026-11-03)

`keyhole-devmo.near` was upgraded in place. Every token, owner, tier, metadata entry and the config (owner, minter, treasury, royalty, beats) is the same as before the upgrade.

| Step | Transaction | Result |
|---|---|---|
| Deploy v2 + `migrate()` in one transaction (atomic: if `migrate` failed, the deploy would roll back) | [`142eipKr…`](https://nearblocks.io/txns/142eipKrruYWL69w31bzCbcSakGvum5XzwTasHxsAdAC) | code_hash `C8pL59r9…` = sha256 `a5712300…` (`contracts/keys/release/v2`) |
| `migrate()` a second time | [`9kmr1tsb…`](https://nearblocks.io/txns/9kmr1tsbbXwdr3y8VcwmBGW5zE44MCcwsSANa7S8C4LY) | expected revert: `already migrated` |
| One key per account: a holder sends its key to another holder (`keyhole-devmo.near` holds key `0`) | [`H8qJNgox…`](https://nearblocks.io/txns/H8qJNgoxiizcJw63wKjtBZY4DQT8qbRx1XP9ejXSjkSV) | expected revert: `one key per account: receiver already holds a KEYHOLE key` |
| Deploy v2.1 (code only; one `nft_transfer` event per `nft_transfer_payout`, naming the marketplace) | [`HahKkkFj…`](https://nearblocks.io/txns/HahKkkFjXQ5xCky8759qNnoEDm8DjizeveS9B6RHNYy1) | code_hash `6uPe67Sg…` = sha256 `57b63c36…` (`contracts/keys/release/v2.1` = `contracts/keys/deployed`) |

## A royalty sale (NEP-178 + NEP-199)

Seller `3bde8ce5…8447` holds key `k5f4750858f328940`. Buyer `0705fdc1…8228` acts as the marketplace: it is approved, moves the key with `nft_transfer_payout`, then pays exactly the payout the contract returned. Price 0.01 NEAR.

| Step | Transaction | Result |
|---|---|---|
| Seller `nft_approve(k5f4750858f328940, buyer)` | [`68er4S4y…`](https://nearblocks.io/txns/68er4S4ypnp7L7dCjMNPsWkQeYSnpCGHKMTSgyVAH9DM) | approval id 2, `nft_is_approved` true |
| Buyer `nft_transfer_payout(balance = 0.01 NEAR, approval_id = 2)` | [`Azn3WUud…`](https://nearblocks.io/txns/Azn3WUudmSn4ip9B9HNVXTGXriavZ4JK5f3Aqp7JPx2m) | returns `{"keyhole-devmo.near":"500000000000000000000","3bde8ce5…8447":"9500000000000000000000"}` (5% / 95%); one `nft_transfer` event with `authorized_id` = buyer; approvals cleared, their storage refunded to the seller |
| Buyer pays the treasury 0.0005 NEAR | [`F4PWSkmf…`](https://nearblocks.io/txns/F4PWSkmfnacCWeX2v68sUL8GZPQNmNo42suHAnfm9Hq) | |
| Buyer pays the seller 0.0095 NEAR | [`Fa6hnsZi…`](https://nearblocks.io/txns/Fa6hnsZiha36XJEqpdeRLjxAr1qaR1cGxJhUGoTH6vM1) | |
| Key returned to the seller | [`DRDtKjYu…`](https://nearblocks.io/txns/DRDtKjYuPJzF3ESGe7Lihtx3tRv7YqN4u5reiYjvGSq4) | `nft_is_approved` for the old buyer is false ([json](nft_is_approved_after_sale.json)) |

The same sale on v2 ([`95DJHsQc…`](https://nearblocks.io/txns/95DJHsQcJLfFdGnKjAH49W4xX82hrGLQqstXZEMkCcf2), paid by [`8YY5Xx3s…`](https://nearblocks.io/txns/8YY5Xx3sY9e4RCMe5FQ6xRvmNifpw6SDirqSFiZ3mCBw) and [`D5xqsdmC…`](https://nearblocks.io/txns/D5xqsdmCM6eA6xR5UEsKSQwz4ktdG5eyXXdPLnCaa8j6), key returned by [`AS8pZ7Kw…`](https://nearblocks.io/txns/AS8pZ7KwHhoFcscUGoDWntCkCemQkDXLvZBURz1BGBJD)) returned the same payout; it logged the transfer twice, which v2.1 fixes.

## Live reads after the upgrade

- [`view_account.json`](view_account.json): code_hash `6uPe67SgsPuE71E73jp8zsbReQPGhTbW8UmUV5mjwtuh`, storage 213,182 bytes.
- [`nft_tokens_before_v1.json`](nft_tokens_before_v1.json) (read before the upgrade) and [`nft_tokens.json`](nft_tokens.json) (after): the same 5 tokens, owners and metadata; `approved_account_ids` is now `{}`.
- `nft_tier` of all 5 tokens: 1 before and after. [`config.json`](config.json) unchanged (owner, minter `015a…c443`, treasury, `royalty_bps` 500, `beats` 2).
- [`contract_source_metadata.json`](contract_source_metadata.json) (NEP-330): nep171, nep177, nep178, nep181, nep199, nep330.

Re-check: `./judge/1-contract.sh`.

## Cost

Gas for both deploys and the second `migrate` call: about 0.0033 NEAR. The larger wasm stakes 12,897 more bytes of storage (about 0.129 NEAR, still held by the account, not spent). The test accounts' gas for the sales was paid from 0.09 NEAR moved to them from `keyhole-devmo.near`.

## How the upgrade was tested first

`contracts/keys-sandbox` (near-workspaces, runs in CI): deploys the v1 wasm, mints the 5 mainnet tokens from a fixture, upgrades to v2, runs `migrate`, and asserts every token, owner, tier, metadata entry and config value is equal; then v2 to v2.1; then NEP-178, one key per account and a royalty sale with real balances.
