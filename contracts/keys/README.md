# KEYHOLE keys contract

One NFT contract: NEP-171 core, NEP-177 metadata, NEP-178 approvals, NEP-181 enumeration, NEP-199 payouts, NEP-330 source metadata. Each token is a viewing key; `tier` (1-3) sets access.

- `nft_mint(token_id, receiver_id, tier, metadata)`: minter only; deposit covers storage, excess refunded.
- One key per account: `nft_mint`, `nft_transfer`, `nft_transfer_call` and `nft_transfer_payout` refuse a receiver that already holds a key (`one key per account: receiver already holds a KEYHOLE key`).
- `nft_approve` / `nft_revoke` / `nft_revoke_all` / `nft_is_approved`: NEP-178. Approvals are cleared on every transfer; `msg` triggers `nft_on_approve` on the approved account.
- `nft_payout` / `nft_transfer_payout`: NEP-199. 5% (`royalty_bps` 500, cap 10%) to the treasury, the rest to the seller; the payout always sums to the sale balance.
- `beat(token_ids)`: minter only; emits NEP-171 1.2.0 `nft_metadata_update`.
- `holder_tier(account_id)`: tier of the key the account holds (used by the TEE gate).
- `set_minter` / `set_royalty`: owner only, 1 yocto.
- `migrate()`: v1 -> v2, self-call only, runs once. Turns on the approval maps; no token, owner, tier, metadata or config changes.

Build: `cargo near build non-reproducible-wasm` (rustc 1.86 via `rust-toolchain.toml`, cargo-near 0.22.0, near-sdk 5.17.2). The build is deterministic: CI rebuilds the source and compares it with `release/SHA256SUMS`.

| | sha256 | where |
|---|---|---|
| v1 | `d985104e128c598996932a1504cff26093277f4528ef513578af7386a29e817b` | `release/v1/keyhole_keys.wasm` |
| v2 | `a57123002dbc164bfd5684dc2a360d35c5681c4b4ab59172cb6c45b331a73ad2` | `release/v2/keyhole_keys.wasm` |

`deployed/keyhole_keys.wasm` is always the code on `keyhole-devmo.near` (checked against the on-chain `code_hash` by `judge/1-contract.sh`).

Tests: `cargo test` (unit) and `cd ../keys-sandbox && cargo test` (near-workspaces: deploys the v1 wasm, mints the 5 mainnet tokens from `tests/fixtures/mainnet_tokens.json`, upgrades to v2, migrates, asserts every token, owner, tier, metadata entry and config is unchanged, then runs NEP-178, one-key and a royalty sale on the sandbox runtime).
