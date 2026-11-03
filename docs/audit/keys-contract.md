# Audit: `contracts/keys`

Date: 2026-10-28. Method: the `near-contract-audit` skill from [near/agent-skills](https://github.com/near/agent-skills/blob/main/skills/near-contract-audit/SKILL.md). Scope: [`contracts/keys/src/lib.rs`](../../contracts/keys/src/lib.rs) and [`contracts/keys/Cargo.toml`](../../contracts/keys/Cargo.toml).

Phase 1 was a manual pass of the detector list in that skill. No extra scanner is configured in this repository. Phase 2 was a read of every public method. The deployed wasm is the file in `contracts/keys/deployed/` and CI checks its sha256 against the chain. This audit does not change that file.

## Result

No high-severity finding that is present in this source. No code change.

## Detectors

| Detector | Result |
|---|---|
| `non-private-callback` | `nft_resolve_transfer` is `#[private]`. No other callback. `migrate` is `#[init(ignore_state)]` and requires `predecessor == current_account_id` explicitly (near-sdk does not apply `#[private]` to init methods); it panics `already migrated` on a second call. |
| `reentrancy` | Promise paths: `nft_transfer_call` and `nft_approve` with `msg` (`nft_on_approve`), both delegated to `near-contract-standards`, plus the approval-storage refund transfer in `nft_transfer_payout`. This file does not update balances after that call. |
| `incorrect-argument-or-return-types` | Payout amounts are `U128`. `config.beats` is `U64`. `tier` is `u8`. Pagination `limit` is the standard `Option<u64>`. |
| `unsaved-changes` | Collections are `near_sdk::collections`, not `near_sdk::store`. `tiers.insert` writes through. |
| `owner-check` | `set_minter` and `set_royalty` call `assert_owner`. `nft_mint` and `beat` call `assert_minter`. `new` requires `predecessor == current_account_id` and is `#[init]`. |
| `yocto-attach` | `set_minter`, `set_royalty`, and `nft_transfer_payout` call `assert_one_yocto`. `nft_approve` needs a deposit that covers the approval's storage; `nft_revoke` and `nft_revoke_all` need 1 yoctoNEAR. Transfers go through the standard, which requires 1 yoctoNEAR. |
| `storage-collision` | Prefixes are the `Key` enum (`Owners`, `TokenMeta`, `Enumeration`, `ContractMeta`, `Tiers`, and `Approvals`, appended in v2 so every v1 prefix is unchanged). |
| `required-initialization-macro` | `new` is `#[init]`. |
| `gas-griefing` | `beat` rejects batches outside 1..=50. `holder_tier` reads that account's keys; the contract keeps the set to one key (`assert_no_key` on mint and on every transfer path). |
| `insecure-random` | No randomness. |
| `prepaid-gas` | No hand-written promise. |
| `unsafe-math` / `float-math` | Royalty uses `u128` division. `[profile.release] overflow-checks = true`. No floats. |

## Design decisions

`holder_tier` returns the highest tier among the tokens that account holds. The walk is bounded by that account's set, and the set is one key by design. `op_mint` returns `already_holder` when a key is already there, and `token_id_for` derives the token id from the account, so a second mint of the same key collides on-chain.

`nft_payout` computes the royalty as `balance * royalty_bps / 10_000` in `u128`. The release profile sets `overflow-checks = true`, so a product that does not fit aborts the call. The split is the royalty and the remainder. It does not wrap. That is the safe behavior.
