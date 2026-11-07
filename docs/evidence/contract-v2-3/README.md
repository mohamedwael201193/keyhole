# Keys contract v2.3 on mainnet (2026-11-07)

`keyhole-devmo.near` was upgraded in place with a code-only deploy. No `migrate` call, no storage layout change. Every token, owner, tier, holder, approval, payout and config value read the same before and after; the one view that changed is NEP-330 `contract_source_metadata`, which now reports version `2.3.0` and the repository link.

## Deploy

| Step | Transaction | Result |
|---|---|---|
| Deploy v2.3 (`DeployContract` only, status success) | [`CM7JvwdnN2…`](https://nearblocks.io/txns/CM7JvwdnN2oQ4xakmcSoDPDREBbE7ZUCh5FnJargd5bp) | block 223497731, 2026-11-07 17:30:12 UTC. code_hash `8YP8Mr2c…WwLG` = sha256 `700bd51f…e09d`, 210,474 bytes (`contracts/keys/release/v2.3` = `contracts/keys/deployed`) |
| Previous version, v2.2 (for reference) | [`GgnNQERT…`](https://nearblocks.io/txns/GgnNQERTj8qKp5VRCdXaTPgb6CjNChamnPsed11AsM5k) | code_hash `BfMiMAfg…xMLeZ` = sha256 `9e685c32…089e`, 209,952 bytes |

After the deploy, `view_account` returns code_hash `8YP8Mr2c8yCxtZU1xtio8K5Lk5YuPC7WPBzuGFS9WwLG`, and storage usage grew from 215,912 to 216,434 bytes (the 522-byte code difference).

## What v2.3 changes

Code only over v2.2:

- NEP-178: at most `MAX_APPROVALS` = 10 approvals per token. An 11th `nft_approve` panics with `approval cap reached: a token holds at most 10 approvals` before any state change or `nft_on_approve` call. Re-approving an account already on the list is still allowed at the cap.
- NEP-330: version `2.3.0`, link `https://github.com/mohamedwael201193/keyhole`. The standards list is unchanged.

## State before and after

"Before" is a read-only snapshot of `keyhole-devmo.near` at block 223495632, taken in a pre-deploy dry run (see below). "After" is a read-only snapshot at final finality after the deploy.

| View | Before | After |
|---|---|---|
| `nft_total_supply` | 6 | 6 (same) |
| `nft_tokens` (limit 50): ids, owners, metadata | 6 tokens, 6 owners | same 6 tokens, same owners, same metadata |
| `nft_tier`, `nft_token`, `nft_metadata` | per token | same |
| `nft_supply_for_owner`, `nft_tokens_for_owner`, `holder_tier`, `pending_return_count` (each owner) | per owner | same |
| `nft_payout` (balance 1,000,000 and 10,000, max 10 payees), every token | per token | same |
| `config` (owner, minter, treasury, `royalty_bps` 500, beats 2) | as listed | same |
| `contract_source_metadata` | version `0.1.0`, link `null` | version `2.3.0`, link set. The only changed value |

The 6 tokens are token `0` (test key, held by `keyhole-devmo.near`) and five keys held by people. Owners and the minter are listed in [`README.md` §5](../../../README.md#5-the-keys-nft-contract).

Re-check: `./judge/1-contract.sh` prints `OK contract code matches the committed wasm`.

## Fork dry run before the deploy

Before the deploy, the real mainnet state was replayed in a local sandbox, with the same v2.2 wasm and then the v2.3 wasm deployed code-only on top. Mainnet was read only: state and view calls at one pinned block, no transaction signed or sent. The result was 26 of 26 checks PASS: 14 view comparisons and 12 owner-path checks.

- **Replay.** All 14 mainnet views equal the sandbox v2.2 clone, and all 45 state records read back byte for byte.
- **Code-only upgrade.** v2.2 to v2.3 changed only `contract_source_metadata` (version and link). Every view and every record was identical.
- **Owner paths on v2.3.**
  - 10 approvals on one token were accepted; the 11th was refused with the cap message, and the count stayed at 10.
  - A transfer to a current key holder was refused with `one key per account: receiver already holds a KEYHOLE key`; the owner did not change.
  - A transfer to a fresh account succeeded and cleared the approvals.
  - `holder_tier` of the new holder equalled the token's tier.
  - `nft_transfer_call` to a receiver that tries to keep the key returned the key to the sender, and `pending_return_count` went back to 0.
  - Total supply and the other five tokens did not change.
- **Control.** The same state on v2.2 accepted an 11th approval, so the refusal comes from v2.3.

Limits of the dry run, stated plainly:

- The owner paths ran on a sandbox clone, with a locally generated key for the owner account. That key is not a mainnet key. Owner-signed calls were not sent to mainnet.
- The sandbox owner was given extra balance. A max-gas owner-signed call was rejected in the sandbox without it. On chain after the deploy the account holds 2.5902 NEAR against 2.1643 NEAR of storage stake, so about 0.426 NEAR is free above stake (computed from `view_account`). Owner-signed max-gas calls on mainnet are not tested, so check the balance before any owner transaction.
- Not tested in the dry run: `migrate` on v2.3 (not needed, no migrate in this release), `nft_approve` with `msg` (the `nft_on_approve` cross-contract call), and a live marketplace sale on v2.3.

## Tests

- `contracts/keys` unit tests include the v2.3 approval-cap tables.
- `contracts/keys-sandbox` (near-workspaces, run in CI) builds v2.2 state, deploys the v2.3 wasm code-only, and asserts that every token, owner, tier, approval, payout, holder and config value is unchanged, that NEP-330 reports `2.3.0`, that the cap holds after the upgrade, and that one-key, `nft_transfer`, the marketplace payout and `nft_transfer_call` still work.
