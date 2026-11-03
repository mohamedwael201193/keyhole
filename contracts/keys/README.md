# KEYHOLE keys contract

One NEP-171/177/181 NFT contract. Each token is a viewing key; `tier` (1-3) sets access.

- `nft_mint(token_id, receiver_id, tier, metadata)`: minter only; deposit covers storage, excess refunded.
- `beat(token_ids)`: minter only; emits NEP-171 1.2.0 `nft_metadata_update`.
- `holder_tier(account_id)`: highest tier held (used by the TEE gate).
- `nft_payout` / `nft_transfer_payout`: NEP-199, royalty to treasury (cap 10%).
- `set_minter` / `set_royalty`: owner only, 1 yocto.

Build: `cargo near build non-reproducible-wasm` (rustc 1.86, near-sdk 5.17.2). Test: `cargo test` (count per commit in the root README §12).

Mainnet: `keyhole-devmo.near`, wasm sha256 `d985104e128c598996932a1504cff26093277f4528ef513578af7386a29e817b` (195,389 bytes).
