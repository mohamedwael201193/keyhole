# KEYHOLE keys contract

One NFT contract: NEP-171 core, NEP-177 metadata, NEP-178 approvals, NEP-181 enumeration, NEP-199 payouts, NEP-330 source metadata. Each token is a viewing key; `tier` (1-3) sets access.

- `nft_mint(token_id, receiver_id, tier, metadata)`: minter only; deposit covers storage, excess refunded.
- One key per account: `nft_mint`, `nft_transfer`, `nft_transfer_call` and `nft_transfer_payout` refuse a receiver that already holds a key (`one key per account: receiver already holds a KEYHOLE key`). An account whose key is out on `nft_transfer_call` counts as a holder until `nft_resolve_transfer` runs (`pending_return_count`).
- `nft_approve` / `nft_revoke` / `nft_revoke_all` / `nft_is_approved`: NEP-178. Approvals are cleared on every transfer; `msg` triggers `nft_on_approve` on the approved account. A token holds at most `MAX_APPROVALS` (10) approvals (v2.3): an 11th `nft_approve` panics `approval cap reached: a token holds at most 10 approvals` before any state change or `nft_on_approve` call. Re-approving an account already on the list is allowed at the cap.
- `nft_payout` / `nft_transfer_payout`: NEP-199. 5% (`royalty_bps` 500, cap 10%) to the treasury, the rest to the seller; the payout always sums to the sale balance.
- `beat(token_ids)`: minter only; emits NEP-171 1.2.0 `nft_metadata_update`.
- `holder_tier(account_id)`: tier of the key the account holds (used by the TEE gate).
- `set_minter` / `set_royalty`: owner only, 1 yocto.
- `migrate()`: v1 -> v2, self-call only, runs once. Turns on the approval maps; no token, owner, tier, metadata or config changes.

Build: `cargo near build non-reproducible-wasm` (rustc 1.86 via `rust-toolchain.toml`, cargo-near 0.22.0, near-sdk 5.17.2). The build is deterministic: CI rebuilds the source and compares it with the v2.3 entry in `release/SHA256SUMS`. The wasm does not depend on the checkout path, but it does depend on the toolchain's sysroot: build with the rustup `minimal` profile (no `rust-src`), as CI does.

| | sha256 | where |
|---|---|---|
| v1 | `d985104e128c598996932a1504cff26093277f4528ef513578af7386a29e817b` | `release/v1/keyhole_keys.wasm` |
| v2 | `a57123002dbc164bfd5684dc2a360d35c5681c4b4ab59172cb6c45b331a73ad2` | `release/v2/keyhole_keys.wasm` (adds NEP-178, one key, `migrate`) |
| v2.1 | `57b63c36d782bb4e60c4a25e9cc238093bc909a328617be864ba6327191a30ac` | `release/v2.1/keyhole_keys.wasm` (`nft_transfer_payout` emits exactly one `nft_transfer` event, with `authorized_id`; no state change) |
| v2.2 | `9e685c32bf5f57e0fda86f270e96f79723b54499a670306bb8f8bc0a68d5089e` | `release/v2.2/keyhole_keys.wasm` (`nft_transfer_call` marks the sender as a holder until `nft_resolve_transfer` runs, so a key that comes back can never meet a second key; no struct change) |
| v2.3 | `700bd51fc1cd9bfb46b655f2c6c77632f2c6b6c3c53329dd2990ea36eb00e09d` | `release/v2.3/keyhole_keys.wasm` (**live on `keyhole-devmo.near` since 2026-11-07**, deploy tx `CM7JvwdnN2…`). Code only, no storage layout change, no `migrate`: a cap of `MAX_APPROVALS` (10) approvals per token, and NEP-330 `contract_source_metadata` version `2.3.0` with link `https://github.com/mohamedwael201193/keyhole`. Standards list unchanged. |

`deployed/keyhole_keys.wasm` is always the code on `keyhole-devmo.near` (checked against the on-chain `code_hash` by `judge/1-contract.sh`). That is v2.3 (`code_hash` `8YP8Mr2c…`, live since 2026-11-07). v2.2 (`code_hash` `BfMiMAfg…`) is the previous version, kept in `release/v2.2`.

Tests: `cargo test` (unit, including the v2.3 approval-cap tables) and `cd ../keys-sandbox && cargo test` (near-workspaces: deploys the v1 wasm, mints the 5 mainnet tokens from `tests/fixtures/mainnet_tokens.json`, upgrades to v2, migrates, asserts every token, owner, tier, metadata entry and config is unchanged, then runs NEP-178, one-key and a royalty sale on the sandbox runtime). The v2.3 sandbox tests build v2.2 state, deploy v2.3 code only, and assert that every token, owner, tier, approval, payout, holder and config value is unchanged, that NEP-330 reports `2.3.0`, that the approval cap holds after the upgrade, and that one-key, `nft_transfer`, the marketplace payout and `nft_transfer_call` still work.
