# Threat model

This file describes the ways a previous holder, a seller, or the operator could try to keep access or funds after a key moves, and what this repository actually does about each one. The live enclave is worker `b3fa1a39`. A check that is only in source is marked as not yet published.

The confidential balances sit in an OutLayer custody wallet. The worker creates that wallet and keeps the API key in enclave storage, under the NEAR account that asked for it (`holder_wallet` in [`tee/worker/src/main.rs`](tee/worker/src/main.rs)). Transferring the NFT does not move that wallet to the new owner. The new owner gets a new custody wallet on their own first call. The previous owner's balances stay in the previous owner's custody wallet, and the worker will not operate it once `holder_tier` for that account is empty.

## Old session

A browser that was signed in before the transfer still has the account in the wallet selector. The next vault call is a new signed request. `authenticate` calls `holder_tier` on that request. If the account no longer holds a key, the worker returns `no_key` and does not read or move the custody wallet.

The website also reads `nft_tokens_for_owner` and, when the list is empty, shows "Only the key holder can open this" instead of the fund, trade, and withdraw forms. That is a display gate. The worker check is the one that refuses the call.

Proof: [`contracts/keys/src/lib.rs`](contracts/keys/src/lib.rs) tests that `holder_tier` is `None` after the token moves (`holder_tier` assertions in the contract unit tests). The worker calls that method on every keyed op (`authenticate` in [`tee/worker/src/main.rs`](tee/worker/src/main.rs)).

## Replayed NEP-413 or EIP-191 signature

`verify_nep413` and `verify_eip191` both return the 32-byte nonce. `consume_nonce` stores `(account, nonce)` once. A second use is `replay`. `check_freshness` rejects `ts_ms` more than five minutes from the final block time with `expired`. The recipient must be `keyhole`.

EIP-191 uses the same nonce store after `verify_eip191`. A recovered address that does not equal the claimed account is `bad_signature`. A tampered message is `bad_signature`.

Proof: `replay_rejected`, `freshness_window`, and `eip191_recovers_the_fixed_vector_and_rejects_a_tamper` in [`tee/worker/src/tests.rs`](tee/worker/src/tests.rs).

## Withdraw aimed at someone other than the signer

`assert_withdraw_to` returns `bad_params` unless `params.to` equals the account that signed. The vault sets `to` to the connected account before it asks for the signature.

Proof: the `assert_withdraw_to` cases in [`tee/worker/src/tests.rs`](tee/worker/src/tests.rs).

## Front-running a withdraw at transfer time

`authenticate` reads `holder_tier` once, at the start of the call, and then the withdraw or swap proceeds. There is no second ownership read immediately before the custody wallet is told to move funds. A transfer that lands after that first read and before the wallet call is not re-checked by the published worker.

That gap is still open in `b3fa1a39`. Closing it means another `nft_token` / `holder_tier` read after the quote and caps, and aborting with `not_owner` without calling the wallet, so the funds stay in the custody account. That re-check is not in this published build, and this file will not claim a test for it until the source has one.

## Operator or server asking the TEE to sign as the user

The website forwards `{op, auth}` and attaches the OutLayer payment key. It does not have the user's private key and does not produce NEP-413 or EIP-191 signatures. `authenticate` rejects a body with no valid signature (`no_auth`, `bad_signature`, `key_not_owned`). `info` and `sweep_minter` do not take a user signature. `sweep_minter` only moves NEAR from this enclave's minter account to the contract's current minter, and only when this enclave is no longer that minter.

The operator can submit any bytes the payment key will pay for. They still cannot pass `authenticate` as the user without that user's signature. The enclave's own minter key can sign `nft_mint` and the sweep. It is not the user's key.

Proof: `verify_nep413` rejects a bad signature, a short nonce, and the wrong recipient in [`tee/worker/src/tests.rs`](tee/worker/src/tests.rs). Gateway tests refuse `swap` and `withdraw` without a matching auth (`web/tests/gateway.test.ts`).

## Stale ownership cache

The worker does not cache `holder_tier`. Each keyed call uses `rpc::view` with finality `final`. The website caches public views (`nft_tokens`, `nft_total_supply`, `config`) for 60 seconds. A view whose method is `nft_tokens_for_owner`, or whose args contain `account_id`, is `isHolderRead` and is not put in that cache (`web/lib/rpc.ts`).

The vault gate can be wrong for one response if the RPC errors. On an error it does not show the non-holder sentence; it leaves the lookup failed. A successful empty owner list shows the gate.

## Worker upgrade

A new wasm has a new sha256. `verify.sh` checks that the attestation's `executed_wasm_sha256` equals the registered `wasm_hash` and the FastFS bytes. `./verify.sh <call_id> --rebuild` also compares a local `tee/worker/build.sh` hash. An old attestation still names the hash that ran. The site treats a hash other than the published list as not the current build (`publishedBuild` in `web/lib/verify.ts`).

Publishing a build is an on-chain `add_version`. It does not rewrite old attestations.

## If TDX breaks

If the quote can be forged, or the enclave memory can be read, the blast radius is the secrets that were inside it:

- The per-holder custody API keys. Whoever has one can talk to the custody API without going through this worker, so the `holder_tier` check is not in that path. Confidential balances for holders whose keys were inside the enclave can be moved. The NFT owner on `keyhole-devmo.near` does not change because of that.
- The minter ed25519 key. Whoever has it can sign `nft_mint` as the minter and can sweep the minter's NEAR. They do not become the user's NEAR account.

What an intact enclave still prevents, and a broken one does not: the worker will not call the custody API unless the signed account currently holds a key. That policy lives in the worker. It is not a rule of the custody wallet or of NEAR Intents. NEAR Intents will settle a swap the custody wallet submits. The chain will not move the NFT unless a real owner signs `nft_transfer`.

A user's NEAR full-access key and a MetaMask key never enter the enclave. A TDX failure does not hand those over.
