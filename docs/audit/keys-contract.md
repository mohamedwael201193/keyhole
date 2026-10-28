# Audit: `contracts/keys`

Date: 2026-10-28. Method: the `near-contract-audit` skill from [near/agent-skills](https://github.com/near/agent-skills/blob/main/skills/near-contract-audit/SKILL.md). Scope: [`contracts/keys/src/lib.rs`](../../contracts/keys/src/lib.rs) and [`contracts/keys/Cargo.toml`](../../contracts/keys/Cargo.toml).

Phase 1 was a manual pass of the detector list in that skill. No extra scanner is configured in this repository. Phase 2 was a read of every public method. The deployed wasm is the file in `contracts/keys/deployed/` and CI checks its sha256 against the chain. This audit does not change that file.

## Result

No high-severity finding that is present in this source. No code change.

## Detectors

| Detector | Result |
|---|---|
| `non-private-callback` | `nft_resolve_transfer` is `#[private]`. No other callback. |
| `reentrancy` | The only promise path is `nft_transfer_call`, delegated to `near-contract-standards`. This file does not update balances after that call. |
| `incorrect-argument-or-return-types` | Payout amounts are `U128`. `config.beats` is `U64`. `tier` is `u8`. Pagination `limit` is the standard `Option<u64>`. |
| `unsaved-changes` | Collections are `near_sdk::collections`, not `near_sdk::store`. `tiers.insert` writes through. |
| `owner-check` | `set_minter` and `set_royalty` call `assert_owner`. `nft_mint` and `beat` call `assert_minter`. `new` requires `predecessor == current_account_id` and is `#[init]`. |
| `yocto-attach` | `set_minter`, `set_royalty`, and `nft_transfer_payout` call `assert_one_yocto`. Transfers go through the standard, which requires 1 yoctoNEAR. |
| `storage-collision` | Prefixes are the `Key` enum (`Owners`, `TokenMeta`, `Enumeration`, `ContractMeta`, `Tiers`). |
| `required-initialization-macro` | `new` is `#[init]`. |
| `gas-griefing` | `beat` rejects batches outside 1..=50. See residual below for `holder_tier`. |
| `insecure-random` | No randomness. |
| `prepaid-gas` | No hand-written promise. |
| `unsafe-math` / `float-math` | Royalty uses `u128` division. `[profile.release] overflow-checks = true`. No floats. |

## Residual (not changed)

`holder_tier` walks every token id the account holds and returns the max tier. The worker mints one key per account. The contract does not enforce that cap. A minter that minted a very large set onto one account would make this view expensive. Capping the walk could hide a higher tier, and changing it would ship a wasm that is not the one on `keyhole-devmo.near`. Left as-is.

`nft_payout` multiplies `balance * royalty_bps / 10_000`. With overflow checks enabled, a hostile `balance` panics the view instead of wrapping. The marketplace passes the sale price. Not changed.
