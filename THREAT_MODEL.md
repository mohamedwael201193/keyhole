# Threat model

This file describes the ways a previous holder, a seller, a buyer, or the operator could try to keep access or take funds when a key moves, and what this repository does about each one. Each section names the code and the test that cover it.

The confidential balances sit in an OutLayer custody wallet. The worker creates that wallet and keeps its API key in enclave storage under the **token**: `t/<token_id>/wallet` (`holder_wallet` in [`tee/worker/src/main.rs`](tee/worker/src/main.rs), `custody_lookup` in [`tee/worker/src/lib.rs`](tee/worker/src/lib.rs)). Whoever owns the token on [`keyhole-devmo.near`](https://nearblocks.io/address/keyhole-devmo.near) operates that wallet. Transferring the NFT transfers the confidential account. The API key never leaves the enclave, so no holder, past or present, ever sees it.

Proof: `transfer_moves_the_confidential_account_to_the_new_holder` in [`tee/worker/src/tests.rs`](tee/worker/src/tests.rs): Alice funds the key, transfers it to Bob, Bob reaches the same wallet and balance and withdraws, Alice is `not_owner`, a replayed nonce is `replay`, and Bob's history does not contain Alice's rows.

## Old session or an old signature

A browser that was signed in before the transfer still has the account in the wallet selector. The next vault call is a new signed request. `authenticate` reads `nft_tokens_for_owner` and `nft_token.owner_id` on that request, before the nonce is consumed. If the signer does not own the key, the answer is `not_owner` and the custody wallet is not touched. A request the previous holder signed before the transfer, and never sent, is also `not_owner`.

The website also reads `nft_tokens_for_owner` and, when the list is empty, shows "Only the key holder can open this" instead of the fund, trade, and withdraw forms. That is a display gate. The worker check is the one that refuses the call.

Proof: `transfer_then_old_signature_is_not_owner` in [`tee/worker/src/tests.rs`](tee/worker/src/tests.rs); contract tests that `holder_tier` is `None` after the token moves.

## Replayed NEP-413 or EIP-191 signature

`verify_nep413` and `verify_eip191` both return the 32-byte nonce. `consume_nonce` stores `(account, nonce)` once. A second use is `replay`. `check_freshness` rejects `ts_ms` more than five minutes from the final block time with `expired`. The recipient must be `keyhole`.

Proof: `replay_rejected`, `freshness_window`, and `eip191_recovers_the_fixed_vector_and_rejects_a_tamper` in [`tee/worker/src/tests.rs`](tee/worker/src/tests.rs).

Nonce records are kept for good: no pruning on the call path. (Build ebeb6a34 pruned them after 15 minutes, but the storage key listing it used blocked signed calls on OutLayer, so that build was rolled back; see SECURITY.md.) A replay is refused as `replay` for as long as the record exists, and as `expired` once its signed time is more than 5 minutes from chain time.

## Withdraw aimed at someone other than the signer

`assert_withdraw_to` returns `bad_params` unless `params.to` equals the account that signed. The vault sets `to` to the connected account before it asks for the signature.

Proof: the `assert_withdraw_to` cases in [`tee/worker/src/tests.rs`](tee/worker/src/tests.rs).

## A withdraw racing the transfer

After the quote and the caps, and immediately before the custody wallet is told to move funds, the worker reads `nft_token.owner_id` again. If the key moved in between, the send is aborted with `not_owner`, the day's cap is rolled back, and the funds stay in the key's account for the new owner. The remaining window is one RPC read. A seller `lock` (below) closes it fully.

What this check does not cover: a send that is already in flight when the key moves. It is not recalled. The payout completes to the holder who signed it while owning the key. Every later request from that holder is refused `not_owner`, and the new holder sees the remaining balance. This happened on mainnet ([docs/evidence/mid-payout](docs/evidence/mid-payout/README.md), 2026-11-01).

Proof: `transfer_while_withdraw_is_pending_does_not_send` and `random_transfer_and_withdraw_never_pays_the_previous_holder`.

## Seller empties the account just before the sale

Before a transfer, the seller is the owner and may withdraw. That is not a bug, but a buyer needs a way to know what they are buying:

- `lock` `{hours: 1..168}`: swap and withdraw answer `locked` until the time passes. The holder cannot lift it early. A lock binds only the owner who set it, so a transfer ends it for the buyer.
- `limits` `{per_tx_usd_micro, daily_usd_micro}`: the holder narrows the tier caps for their key. Both must be above 0, within the tier, and per-trade at or under per-day. A cut applies at once and cancels a pending raise. A raise waits 24 hours (`set_policy`), so a stolen signature cannot lift the caps and drain in one go. Every quote, swap and withdraw uses the narrowed caps (`effective_limits`). Limits bind only the owner who set them; a buyer starts at the tier caps.
- Transfer cooldown: when the enclave first sees a new owner (a `transfer` row in the key log), withdraw answers `cooldown` for 10 minutes (`assert_no_cooldown`). Swaps inside the account still run. The window starts when the enclave records the transfer, which is the new owner's first signed call or a public `provenance` read, not the block of the transfer.
- `prove` `{token, min}`: the enclave signs `{token_id, owner, asset, min, holds_at_least, locked_until_ms, log_head, ts_ms}` with the minter key. It states a threshold and yes or no, never the balance. `node tee/worker/verify-log.mjs --proof proof.json` checks the signature against the minter's public key.
- Listed for sale: while the keys contract shows a listing for the key (`nft_listing`, read live with finality final), the enclave refuses `withdraw`, `swap`, `copy` and `chain_sign` with `listed`, before any spend is held. `chain_sign` is included because a signature for the key's address can spend what sits at that address on another chain. Reads (`balance`, `history`, `prove`, `dashboard`, and the rest) stay open so a buyer can check the account. A contract without `nft_listing` (v2.3) answers method-not-found, which counts as not listed. Any other RPC error refuses the move with `rpc`. A listing made while a send is already in flight is not recalled, the same as a transfer. Proof: `listed_key_refuses_every_value_move`, `method_not_found_counts_as_not_listed`, `other_listing_errors_fail_closed` in [`tee/worker/src/tests.rs`](tee/worker/src/tests.rs).

A buyer should ask for a fresh `prove` with `locked_until_ms` later than the settlement time. The proof is a statement at `ts_ms`. It is not an escrow; the NEAR transfer and the payment are still separate actions.

Proof: `seller_lock_binds_only_the_owner_who_set_it` and `balance_proof_names_a_threshold_and_verifies`; `node tee/worker/verify-log.mjs --self-test`.

## What a buyer learns about the seller

The buyer sees the key's current balance, which is the thing they bought. `history` returns only the trade-log rows the caller wrote, and the key log returns the private `detail` only for rows the caller owns. Rows written before the buyer's ownership come back as hashes. The public `provenance` op returns kinds, owners and hashes only; owners of an NFT are public on NEAR anyway.

Proof: `history_for` assertions in `transfer_moves_the_confidential_account_to_the_new_holder` and `legacy_wallet_migrates_once_to_one_token`.

## Wallets created by earlier builds

Builds up to `b3fa1a39` stored the wallet per NEAR account (`h/<account>/wallet`). On the first call by the current owner of a key, `custody_lookup` binds that legacy wallet to the key once: it claims `h/<account>/migrated` with `set_if_absent` first, so one legacy wallet goes to at most one key even under concurrent calls, and a second key the same account holds gets a new wallet. The legacy trade log is copied with `by` set to that owner, so a later buyer does not read it.

Proof: `legacy_wallet_migrates_once_to_one_token`.

## Minting again after selling

The token id is derived from the minting account. An account that minted and then transferred its key has no key, so it could ask to mint again with the same id, which used to fail on chain after the minter paid gas. The worker now reads `nft_token` for that id first and answers `already_minted` without sending. Separately, `minter_low_balance` is returned when the minter cannot cover the deposit plus the 20 Tgas that NEAR charges up front.

Proof: `re_mint_after_transfer_is_refused_before_sending` and `mint_gas_and_minter_balance`.

## Operator or server asking the TEE to sign as the user

The website forwards `{op, auth}` and attaches the OutLayer payment key. It does not have the user's private key and does not produce NEP-413 or EIP-191 signatures. `authenticate` rejects a body with no valid signature (`no_auth`, `bad_signature`, `key_not_owned`). `info` and `sweep_minter` do not take a user signature. `sweep_minter` only moves NEAR from this enclave's minter account to the contract's current minter, and only when this enclave is no longer that minter.

The operator can submit any bytes the payment key will pay for. They still cannot pass `authenticate` as the user without that user's signature. The enclave's own minter key can sign `nft_mint` and the sweep. It is not the user's key.

Proof: `verify_nep413` rejects a bad signature, a short nonce, and the wrong recipient in [`tee/worker/src/tests.rs`](tee/worker/src/tests.rs). Gateway tests refuse `swap` and `withdraw` without a matching auth (`web/tests/gateway.test.ts`).

## Stale ownership cache

The worker does not cache ownership (`holder_tier`, `nft_tokens_for_owner`, `nft_token`). Each keyed call uses `rpc::view` with finality `final`. The website caches public views (`nft_tokens`, `nft_total_supply`, `config`) for 60 seconds. A view whose method is `nft_tokens_for_owner`, or whose args contain `account_id`, is `isHolderRead` and is not put in that cache (`web/lib/rpc.ts`).

The vault gate can be wrong for one response if the RPC errors. On an error it does not show the non-holder sentence; it leaves the lookup failed. A successful empty owner list shows the gate.

## Worker upgrade

A new wasm has a new sha256. `verify.sh` checks that the attestation's `executed_wasm_sha256` equals the registered `wasm_hash` and the FastFS bytes. `./verify.sh <call_id> --rebuild` also compares a local `tee/worker/build.sh` hash. An old attestation still names the hash that ran. The site treats a hash other than the published list as not the current build (`publishedBuild` in `web/lib/verify.ts`).

Publishing a build is an on-chain `add_version`. It does not rewrite old attestations.

## If TDX breaks

If the quote can be forged, or the enclave memory can be read, the blast radius is the secrets that were inside it:

- The per-key custody API keys. Whoever has one can talk to the custody API without going through this worker, so the ownership check is not in that path. Confidential balances of those keys can be moved. The NFT owner on `keyhole-devmo.near` does not change because of that.
- The minter ed25519 key. Whoever has it can sign `nft_mint` as the minter and can sweep the minter's NEAR. They do not become the user's NEAR account.
- The same minter key signs key-log heads and `prove` statements, so it could forge a balance proof. A buyer relying on a proof is trusting the attested enclave, the same as every other answer.

What an intact enclave still prevents, and a broken one does not: the worker will not call the custody API unless the signed account currently holds a key. That policy lives in the worker. It is not a rule of the custody wallet or of NEAR Intents. NEAR Intents will settle a swap the custody wallet submits. The chain will not move the NFT unless a real owner signs `nft_transfer`.

A user's NEAR full-access key and a MetaMask key never enter the enclave. A TDX failure does not hand those over.
