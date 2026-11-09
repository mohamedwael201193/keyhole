# Keys contract v2.4 on mainnet (2026-11-08, 23:43 UTC)

`keyhole-devmo.near` was upgraded in place with a code-only deploy. No `migrate` call and no storage layout change. Every token, owner, tier, metadata entry and config value read the same before and after. Three things changed: the code, NEP-330 `contract_source_metadata` (version `2.3.0` to `2.4.0`), and the new methods `nft_set_tier`, `nft_list`, `nft_unlist`, `nft_buy`, `nft_listing` and `nft_listings`.

## Deploy

| Step | Transaction | Result |
|---|---|---|
| Deploy v2.4 (`DeployContract` only, status success, signer and receiver `keyhole-devmo.near`) | [`84zVBikU…`](https://nearblocks.io/txns/84zVBikU5JrAAnyaXTHQWwQSuq15zgLmMFJZsVnJZsPn) | block `223686683`, 2026-11-08 23:43:53 UTC. code_hash `DEXHHyEM…SiZZ` = base58 of sha256 `b5c30849…1a1e5c`, 241,621 bytes (`contracts/keys/release/v2.4` = `contracts/keys/deployed`) |
| Previous version, v2.3 | [`CM7JvwdnN2…`](https://nearblocks.io/txns/CM7JvwdnN2oQ4xakmcSoDPDREBbE7ZUCh5FnJargd5bp) ([evidence](../contract-v2-3/README.md)) | code_hash `8YP8Mr2c…WwLG` = sha256 `700bd51f…e09d`, 210,474 bytes |

After the deploy, `view_account` at final finality returns code_hash `DEXHHyEMdFTdFQ32dYnj264RSj3QG2FSwCY5fbjzSiZZ` and storage usage `247,663` bytes. Before it, the same account had storage usage `216,516` bytes and code_hash `8YP8Mr2c8yCxtZU1xtio8K5Lk5YuPC7WPBzuGFS9WwLG`.

## Views before and after

"Before" is a read-only RPC query pinned to the block before the deploy (`D91KJx7B…`, height `223686682`). "After" is a read-only RPC query at final finality. Nothing was signed or sent.

| View | Before (v2.3) | After (v2.4) |
|---|---|---|
| `contract_source_metadata` `version` | `2.3.0` | `2.4.0` (the only NEP-330 change; link unchanged) |
| `nft_total_supply` | `"6"` | `"6"` (same) |
| `nft_tokens` (ids and owners) | 6 tokens | same 6 tokens, same owners |
| `config` | `owner` `keyhole-devmo.near`, `minter` `015a0259…c443`, `treasury` `keyhole-devmo.near`, `royalty_bps` 500, `beats` `"2"` | same |
| `nft_metadata` | `KEYHOLE` / `KEY` | same |
| `nft_listings` | method not found in v2.3 | `[]` (no key is listed) |
| `nft_listings` with `from_index` `0`, `limit` `100` | not available | `[]` |

The 6 tokens are token `0` (test key, held by `keyhole-devmo.near`) and five keys held by people. The owner table is in [`README.md` §9](../../../README.md#keys-on-the-contract).

Re-check: `./judge/1-contract.sh` prints `OK   contract code matches the committed wasm`, with the v2.4 code hash.

## What v2.4 adds

Code only over v2.3. The full description is in [`contracts/keys/README.md`](../../../contracts/keys/README.md):

- `nft_set_tier(token_id, tier)`, minter only: raises a key's tier to `1..=3`, strictly upward. Emits NEP-171 `nft_metadata_update`. Used for earned tiers.
- Built-in key sale: `nft_list`, `nft_unlist`, `nft_buy`, with views `nft_listing` and `nft_listings`. A listing deposit of 0.01 NEAR, a 5% royalty to the treasury, and every other transfer path ends the listing. Events `key_list`, `key_unlist`, `key_sale` and `key_listing_stale` (`keyhole` standard, 1.0.0).
- NEP-330: version `2.4.0`, link `https://github.com/mohamedwael201193/keyhole`. The standards list is unchanged.

## Not checked here

- The sale and `nft_set_tier` paths were not called on mainnet. They are covered by the unit tests and the sandbox tests in `contracts/keys` and `contracts/keys-sandbox`, not by a mainnet transaction in this note.
- Listing and buying a real key on mainnet is a separate step with its own evidence. None is recorded here.
